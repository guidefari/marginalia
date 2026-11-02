"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { failureSentence } from "./failure-copy";
import { createFollower } from "./listen-follow";
import {
  buildQueue,
  firstItemFrom,
  gapAfter,
  MAX_IN_FLIGHT,
  nextBlockItem,
  planFetches,
  previousItem,
  type QueueItem,
  TITLE_BLOCK,
} from "./listen-queue";
import { getArticleBody, getParagraphs } from "./paragraphs";
import { type NarrationEntry, narrationEntries } from "./spoken-text";

/**
 * Makes one clip of speech for `text`. Convex actions can't be cancelled, so
 * `signal` only lets the player ignore a result that arrives after Stop.
 */
export type ClipSource = (
  text: string,
  signal: AbortSignal,
  context?: Pick<QueueItem, "kind" | "heading">,
) => Promise<Blob>;

const readingEstimates = new WeakMap<Blob, number>();
/** Delivery has no timestamps, but the prepared script gives a better pacing estimate. */
export function rememberClipSpeech(blob: Blob, text: string): Blob {
  readingEstimates.set(
    blob,
    Math.max(1, text.trim().split(/\s+/).length / 2.5),
  );
  return blob;
}

export type ListenStatus =
  | "idle"
  | "preparing"
  | "playing"
  | "gap"
  | "paused"
  | "failed"
  | "finished";

export interface PlayerSnapshot {
  status: ListenStatus;
  /** The block being spoken or waited for, `null` when nothing is. */
  index: number | null;
  /** The sentence to show while `failed`. */
  error: string | null;
  /** Whether the page is following the voice (D-TTS-012). */
  following: boolean;
}

const IDLE: PlayerSnapshot = {
  status: "idle",
  index: null,
  error: null,
  following: true,
};

// A silent clip played inside the click or keypress, so mobile browsers count
// the element as user-activated for the rest of the session (05-player)
export const SILENT_CLIP =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

type ClipEntry =
  | { status: "pending" }
  | { status: "ready"; blob: Blob }
  | { status: "failed"; error: unknown };

interface PlayerEnv {
  paragraphs: () => HTMLElement[];
  body: () => HTMLElement | null;
  clipSource: () => ClipSource;
  /** The spoken title, said before the first paragraph of a listen from the top. */
  intro: () => string | undefined;
  /** The reader's speed, read whenever a clip starts. */
  speed: () => number;
  publish: (snapshot: PlayerSnapshot) => void;
}

function clearMarks() {
  for (const el of document.querySelectorAll(
    "[data-speaking], [data-speaking-pending], [data-fading]",
  )) {
    el.removeAttribute("data-speaking");
    el.removeAttribute("data-speaking-pending");
    el.removeAttribute("data-fading");
  }
}

const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

/**
 * Requests that haven't settled, across Stop, restart and remount, for every
 * player: an action can't be cancelled, so an abandoned request still costs a
 * slot until it answers.
 */
let unsettled = 0;
/** The planners of the players that are listening, woken whenever any request settles. */
const planners = new Set<() => void>();
/** Samples waiting for a slot, in order. Each takes one if it can and says whether it did. */
const slotWaiters: (() => boolean)[] = [];
const wakePlanners = () => {
  // A waiting sample goes first: the reader is listening for it, and a
  // sample pauses Listen, so its lookahead can wait
  while (slotWaiters.length && unsettled < MAX_IN_FLIGHT)
    if (!slotWaiters[0]()) break;
    else slotWaiters.shift();
  for (const plan of [...planners]) plan();
};

/**
 * Runs a speech request made outside a player (a voice sample) under the same
 * cap: it waits for a free slot, holds it until it settles, and is dropped
 * unsent if `signal` aborts while it waits.
 */
export function trackSpeechRequest<T>(
  work: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const slot = new Promise<void>((resolve, reject) => {
    const take = () => {
      if (unsettled >= MAX_IN_FLIGHT) return false;
      unsettled += 1;
      signal.removeEventListener("abort", drop);
      resolve();
      return true;
    };
    const drop = () => {
      const at = slotWaiters.indexOf(take);
      if (at !== -1) slotWaiters.splice(at, 1);
      reject(new DOMException("The sample was cancelled.", "AbortError"));
    };
    if (signal.aborted) return drop();
    if (take()) return;
    slotWaiters.push(take);
    signal.addEventListener("abort", drop, { once: true });
  });
  return slot.then(() =>
    new Promise<T>((resolve) => resolve(work())).finally(() => {
      unsettled -= 1;
      wakePlanners();
    }),
  );
}

/**
 * The state machine of 05-player. It lives outside React so that the audio
 * events, timers and fetch completions that drive it all see one current
 * state; the hook only publishes snapshots. Every async completion checks the
 * `session` it began in, which Stop, restart and unmount all advance.
 */
function createPlayer(env: PlayerEnv) {
  let audio: HTMLAudioElement | null = null;
  let session = 0;
  let abort: AbortController | null = null;
  let paragraphs: HTMLElement[] = [];
  let entries: NarrationEntry[] = [];
  let queue: QueueItem[] = [];
  const clips = new Map<number, ClipEntry>();
  let playing = -1;
  /** The object URL set on the audio element for the item at `playing`. */
  let loaded: string | null = null;
  /**
   * The one live object URL: the playing clip's, minted when it starts and
   * revoked when the player moves to another item. Every other clip stays a Blob
   * in `clips` for the whole run, so Previous never pays for a clip twice.
   */
  let liveUrl: string | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let resume: (() => void) | null = null;
  let status: ListenStatus = "idle";
  let lastError: string | null = null;
  const follower = createFollower(() => set(status, lastError));
  /** Counts pauses, so a play() that began before one doesn't announce "playing" after it. */
  let pauses = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The item whose clip the element holds, which Previous measures its 3 s against. */
  let holding = -1;
  /** Whether the playing item's clip has been heard: its play() resolved. */
  let started = false;
  /** Items whose clip has sounded this run, which a voice change leaves alone. */
  const heard = new Set<number>();
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  function set(next: ListenStatus, error: string | null = null) {
    status = next;
    lastError = error;
    // The title item is announced as the first paragraph, which it precedes
    const anchor = queue[playing] ? Math.max(0, queue[playing].block) : null;
    const block = anchor === null ? null : (entries[anchor]?.sourceIndex ?? 0);
    env.publish(
      next === "idle" || next === "finished"
        ? { status: next, index: null, error: null, following: true }
        : {
            status: next,
            index: block,
            error,
            following: follower.following,
          },
    );
  }

  function mark(block: number, kind: "speaking" | "pending") {
    clearMarks();
    const el = paragraphs[block];
    if (!el) return;
    el.setAttribute(
      kind === "speaking" ? "data-speaking" : "data-speaking-pending",
      "",
    );
    follower.reveal(el, queue[playing]?.sourceStart ?? 0);
  }

  /** The block the voice is on, which Follow brings back. */
  function currentBlock(): HTMLElement | undefined {
    const item = queue[playing];
    return item ? paragraphs[Math.max(0, item.block)] : undefined;
  }

  function onEnded() {
    // A failure waits for Retry, whatever the element reports afterwards
    if (status === "failed" || loaded === null || audio?.src !== loaded) return;
    // Nothing is loaded for the next item yet, so a pause in the gap or while
    // preparing has no element to pause
    loaded = null;
    const next = playing + 1;
    const proceed = () => {
      if (next >= queue.length) {
        finishRun();
        return;
      }
      const wait = gapAfter(queue, playing, document.hidden, env.speed());
      if (wait === 0) {
        begin(next);
        return;
      }
      set("gap");
      resume = () => begin(next);
      gapTimer = setTimeout(() => {
        resume = null;
        begin(next);
      }, wait);
    };
    // Pause ran just before this event was handled: the reader asked for
    // silence, so Resume is what moves on, with the usual gap
    if (status === "paused") resume = proceed;
    else proceed();
  }

  /** The end of a listen: the last highlight fades over 600 ms instead of vanishing. */
  function finishRun() {
    const last = document.querySelector("[data-speaking]");
    teardown();
    if (last) {
      last.setAttribute("data-fading", "");
      fadeTimer = setTimeout(() => last.removeAttribute("data-fading"), 800);
    }
    set("finished");
  }

  function onError() {
    if (loaded === null || audio?.src !== loaded) return;
    const i = playing;
    discard(i);
    fail(i, new Error("The clip could not be played."));
  }

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio();
      audio.preservesPitch = true;
      applyRate(audio);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      audio.addEventListener("timeupdate", followProgress);
    }
    return audio;
  }

  /** Kokoro has no word timings; track the current source block proportionally. */
  function followProgress() {
    if (status !== "playing" || !audio) return;
    const item = queue[playing];
    if (!item || item.block < 0) return;
    // Kokoro MP3 headers can report an incorrect duration. This is a reading
    // estimate, not word alignment, and never controls audio advancement.
    const clip = clips.get(playing);
    const estimatedSeconds =
      (clip?.status === "ready"
        ? readingEstimates.get(clip.blob)
        : undefined) ?? Math.max(1, item.text.split(/\s+/).length / 2.5);
    const progress =
      item.sourceStart +
      (item.sourceEnd - item.sourceStart) *
        Math.min(1, Math.max(0, audio.currentTime / estimatedSeconds));
    const el = paragraphs[item.block];
    if (el) follower.reveal(el, progress);
  }

  /**
   * Loading a new `src` resets `playbackRate` to `defaultPlaybackRate`, so both
   * are set, and again before every clip starts.
   */
  function applyRate(el: HTMLAudioElement) {
    const rate = env.speed();
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }

  function revokeLive() {
    if (liveUrl !== null) URL.revokeObjectURL(liveUrl);
    liveUrl = null;
  }

  /** Drops a clip that can't be played and unloads it from the element. */
  function discard(i: number) {
    loaded = null;
    revokeLive();
    clips.set(i, { status: "failed", error: new Error("playback") });
  }

  function teardown() {
    session += 1;
    abort?.abort();
    abort = null;
    clearTimeout(gapTimer);
    clearTimeout(fadeTimer);
    clearRestart();
    planners.delete(fetchAhead);
    resume = null;
    loaded = null;
    holding = -1;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    revokeLive();
    clips.clear();
    heard.clear();
    queue = [];
    paragraphs = [];
    entries = [];
    playing = -1;
    follower.stop();
    clearMarks();
  }

  function request(i: number) {
    const token = session;
    const entry: ClipEntry = { status: "pending" };
    clips.set(i, entry);
    unsettled += 1;
    const source = env.clipSource();
    const signal = abort?.signal ?? new AbortController().signal;
    // Whatever the outcome, a request that ends frees a slot, so the current run
    // plans again; otherwise a skip made while the slots were full never gets
    // its own item requested, and a restart waits on the slots the last run held
    new Promise<Blob>((resolve) =>
      resolve(source(queue[i].text, signal, queue[i])),
    ).then(
      (blob) => {
        unsettled -= 1;
        // Stop, restart or unmount ran while this was in flight: the result is
        // late and is dropped. Otherwise it is kept for the run, wherever the
        // voice is now, so nothing is ever requested twice
        if (token === session && clips.get(i) === entry) {
          clips.set(i, { status: "ready", blob });
          if (status === "preparing" && playing === i) play(i, blob);
        }
        wakePlanners();
      },
      (error: unknown) => {
        unsettled -= 1;
        if (token === session && clips.get(i) === entry) {
          clips.set(i, { status: "failed", error });
          if (status === "preparing" && playing === i) fail(i, error);
        }
        wakePlanners();
      },
    );
  }

  const statuses = () =>
    new Map([...clips].map(([i, entry]) => [i, entry.status] as const));

  function fetchAhead() {
    // Between runs there is nothing to plan, only slots a late result gave back
    if (playing < 0) return;
    for (const i of planFetches(queue.length, playing, statuses(), unsettled))
      request(i);
  }

  /** Starts the element on `loaded` and, once the sound has begun, moves the highlight. */
  function playLoaded(i: number) {
    const token = session;
    const url = loaded;
    const pausedAt = pauses;
    const el = ensureAudio();
    applyRate(el);
    const attempt = el.play();
    resume = null;
    // A resumed or retried clip is starting again: until play() resolves it is
    // neither paused nor failed, so Pause can stop it and a voice change can
    // replace it
    if (status === "paused" || status === "failed") set("preparing");
    attempt.then(
      () => {
        if (token !== session || loaded !== url || pausedAt !== pauses) return;
        started = true;
        heard.add(i);
        mark(queue[i].block, "speaking");
        set("playing");
        resume = null;
      },
      (error: unknown) => {
        if (token !== session || loaded !== url || isAbort(error)) return;
        fail(i, error);
      },
    );
  }

  function play(i: number, blob: Blob) {
    revokeLive();
    const url = URL.createObjectURL(blob);
    liveUrl = url;
    loaded = url;
    holding = i;
    ensureAudio().src = url;
    playLoaded(i);
  }

  function prepare(i: number) {
    set("preparing");
    const block = queue[i].block;
    if (!paragraphs[block]?.hasAttribute("data-speaking"))
      mark(block, "pending");
    resume = () => begin(i);
  }

  function fail(i: number, error: unknown) {
    audio?.pause();
    playing = i;
    clearTimeout(gapTimer);
    const block = queue[i].block;
    if (!paragraphs[block]?.hasAttribute("data-speaking"))
      mark(block, "pending");
    set("failed", failureSentence(error, "The voice stopped."));
  }

  /** Moves the voice to item `i`: plays it if its clip is ready, else waits for it. */
  function begin(i: number) {
    playing = i;
    started = false;
    loaded = null;
    clearTimeout(gapTimer);
    // The previous item's clip is done with: its URL goes, its Blob stays
    revokeLive();
    fetchAhead();
    const entry = clips.get(i);
    if (entry?.status === "ready") play(i, entry.blob);
    else if (entry?.status === "failed") fail(i, entry.error);
    else prepare(i);
  }

  function retry() {
    if (status !== "failed" || playing < 0) return;
    if (clips.get(playing)?.status === "failed") clips.delete(playing);
    begin(playing);
  }

  function clearRestart() {
    clearTimeout(restartTimer);
    for (const el of document.querySelectorAll("[data-restarting]"))
      el.removeAttribute("data-restarting");
  }

  /**
   * Previous that restarts the block leaves the highlight where it was, which
   * reads as a dead button, so the wash fades in again on the same paragraph.
   */
  function cueRestart(block: number) {
    clearRestart();
    const el = paragraphs[block];
    if (!el) return;
    // Reading layout ends the old animation, so re-adding the attribute replays it
    void el.offsetWidth;
    el.setAttribute("data-restarting", "");
    restartTimer = setTimeout(clearRestart, 700);
  }

  function jump(i: number) {
    loaded = null;
    audio?.pause();
    begin(i);
  }

  return {
    /** Starts at `block`. Must run inside the click or keypress, before any await. */
    start(block: number) {
      teardown();
      const el = ensureAudio();
      el.src = SILENT_CLIP;
      el.play().catch(() => undefined);
      entries = narrationEntries(env.body(), env.paragraphs());
      paragraphs = entries.map((entry) => entry.element);
      follower.start();
      abort = new AbortController();
      planners.add(fetchAhead);
      const lang = document.documentElement.lang || "en";
      const from =
        block <= 0
          ? 0
          : entries.findIndex(
              (entry) => (entry.sourceEndIndex ?? entry.sourceIndex) >= block,
            );
      if (from < 0) {
        teardown();
        set("finished");
        return;
      }
      queue = buildQueue(
        entries.map((entry) => entry.spoken),
        from,
        lang,
        block <= 0 ? env.intro() : undefined,
        1000,
      );
      const first = firstItemFrom(queue, from === 0 ? TITLE_BLOCK : from);
      if (first === null) {
        teardown();
        set("finished");
        return;
      }
      begin(first);
    },
    stop() {
      const wasIdle = status === "idle";
      teardown();
      if (!wasIdle) set("idle");
    },
    togglePause() {
      if (status === "paused") {
        const continueFrom = resume;
        resume = null;
        continueFrom?.();
        return;
      }
      if (status === "playing" || status === "gap" || status === "preparing") {
        pauses += 1;
        const i = playing;
        if (loaded !== null) {
          // A clip is loaded, playing or about to: pause the element itself and
          // carry on with that same clip. This covers a play() still pending.
          audio?.pause();
          resume = () => playLoaded(i);
        } else {
          // Waiting on a clip or a gap: the continuation set then still holds
          clearTimeout(gapTimer);
        }
        set("paused");
      }
    },
    next() {
      if (playing < 0) return;
      const target = nextBlockItem(queue, playing);
      if (target === null) finishRun();
      else jump(target);
    },
    previous() {
      if (playing < 0) return;
      // Only the playing item's own clip has a time worth measuring
      const elapsed = holding === playing ? (audio?.currentTime ?? 0) : 0;
      const target = previousItem(queue, playing, elapsed);
      if (queue[target].block === queue[playing].block)
        cueRestart(Math.max(0, queue[target].block));
      jump(target);
    },
    retry,
    /** Applies the reader's speed to the clip that is playing; later clips read it as they start. */
    setSpeed() {
      if (audio) applyRate(audio);
    },
    /** Scrolls the speaking block to the reading line and follows it again. */
    follow() {
      if (playing < 0) return;
      follower.follow(currentBlock());
    },
    /**
     * The voice changed: what's ahead is dropped and asked for again in the new
     * voice. The playing clip finishes in the old one, and clips already heard
     * stay for Previous. A request still in flight answers into nothing.
     */
    revoice() {
      if (playing < 0) return;
      // A current clip that hasn't been heard goes too, unless it failed:
      // Retry owns a failure, whether the clip or its playback failed
      const unheard =
        !started &&
        status !== "failed" &&
        clips.get(playing)?.status !== "failed";
      // Clips ahead, and any behind that were skipped before they sounded, are
      // asked for again in the new voice when the voice reaches them
      for (const i of [...clips.keys()])
        if (
          i > playing ||
          (i < playing && !heard.has(i)) ||
          (unheard && i === playing)
        )
          clips.delete(i);
      // Playback failed before the clip was heard: the failure stays on screen,
      // and marking the clip failed makes Retry ask for it in the new voice
      if (
        status === "failed" &&
        !started &&
        clips.get(playing)?.status === "ready"
      )
        clips.set(playing, {
          status: "failed",
          error: new Error("The voice changed."),
        });
      if (unheard && loaded !== null) {
        // Loaded but not yet sounding (play() pending, or paused before it
        // resolved): unload it, so the new voice's clip is what starts
        loaded = null;
        holding = -1;
        audio?.pause();
        revokeLive();
        if (status === "paused") resume = () => begin(playing);
        else prepare(playing);
      }
      fetchAhead();
    },
  };
}

/**
 * Reads the article aloud with natural voices: one clip per block, made by
 * `clipSource` and played through a single audio element (05-player).
 */
export function useNaturalVoice(
  containerRef: RefObject<HTMLElement | null>,
  articleId: string | undefined,
  unitKey: string | null | undefined,
  content: string | undefined,
  contentHtml: string | undefined,
  clipSource: ClipSource,
  intro?: string,
  speed = 1,
) {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(IDLE);
  const source = useRef(clipSource);
  source.current = clipSource;
  const container = useRef(containerRef);
  container.current = containerRef;
  const spokenIntro = useRef(intro);
  spokenIntro.current = intro;
  const rate = useRef(speed);
  rate.current = speed;
  const player = useRef<ReturnType<typeof createPlayer>>(null);
  player.current ??= createPlayer({
    paragraphs: () => getParagraphs(getArticleBody(container.current.current)),
    body: () => getArticleBody(container.current.current),
    clipSource: () => source.current,
    intro: () => spokenIntro.current,
    speed: () => rate.current,
    publish: (next) =>
      setSnapshot((prev) =>
        prev.status === next.status &&
        prev.index === next.index &&
        prev.error === next.error &&
        prev.following === next.following
          ? prev
          : next,
      ),
  });
  const current = player.current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new source is a new voice
  useEffect(() => {
    current.revoice();
  }, [current, clipSource]);

  // Speed applies at once, mid-clip; the next clip reads it when it starts
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new speed is the trigger
  useEffect(() => {
    current.setSpeed();
  }, [current, speed]);

  // Prose identity, not paragraph geometry or arriving annotations, ends speech.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes invalidate the captured paragraph array
  useEffect(() => {
    current.stop();
    return current.stop;
  }, [current, articleId, unitKey, content, contentHtml]);

  return {
    supported: typeof Audio !== "undefined",
    index: snapshot.index,
    paused: snapshot.status === "paused",
    active: !["idle", "finished"].includes(snapshot.status),
    status: snapshot.status,
    error: snapshot.error,
    following: snapshot.following,
    follow: current.follow,
    speakFrom: current.start,
    togglePause: current.togglePause,
    stop: current.stop,
    previous: current.previous,
    next: current.next,
    retry: current.retry,
  };
}
