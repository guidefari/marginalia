"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Play, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { InlineError } from "@/components/in-place";
import { failureSentence } from "@/lib/failure-copy";
import {
  formatSpeed,
  MAX_SPEED,
  MIN_SPEED,
  SPEED_STEP,
} from "@/lib/listen-speed";
import { createTextPreparer } from "@/lib/narration-preparation";
import { SILENT_CLIP, trackSpeechRequest } from "@/lib/use-natural-voice";
import { requestSpeechClip } from "@/lib/use-speech-clip";
import { cn } from "@/lib/utils";

/** What a sample needs from the reader: the article, and what to read. */
export interface VoiceSampleSource {
  articleId: Id<"articles">;
  /** The opening of the paragraph the reader is on. */
  text: () => string;
  /** Listen's state, so a sample doesn't talk over it. */
  listenPlaying: boolean;
  listenPaused: boolean;
  toggleListenPause: () => void;
}

type Sampling = { voice: string; token: number };
type SampleRequest = Sampling & { text: string };

// One sample request at a time, across closing and reopening settings: a
// request already sent can't be called back, so it keeps the turn until it
// answers. A press meanwhile waits in `nextSample`, and a later press replaces
// it, so trying voices quickly sends one request for the first and the last.
let sampleInFlight = false;
let nextSample: (() => void) | null = null;

/**
 * Settings › Listening (03-voices-and-providers): the Kokoro voices as a radio
 * group, each with a sample read from the paragraph the reader is on.
 */
export function ListeningSettings({
  sample,
  speed,
  onAddKey,
}: {
  sample: VoiceSampleSource | undefined;
  /** The reader's listening speed, mirrored by the pill's speed button. */
  speed?: { value: number; onChange: (value: number) => void };
  onAddKey: () => void;
}) {
  const choice = useQuery(api.userSettings.getSpeechVoice, {});
  const capabilities = useQuery(api.providerCredentials.capabilities, {});
  const noKey = capabilities?.providers.includes("openrouter") === false;
  const sampleArticleId = sample?.articleId;
  const prepare = useMemo(
    () => (sampleArticleId ? createTextPreparer(sampleArticleId) : undefined),
    [sampleArticleId],
  );
  // The radio moves at once and the next clip Listen asks for is in the new voice
  const setVoice = useMutation(
    api.userSettings.setSpeechVoice,
  ).withOptimisticUpdate((store, { voice }) => {
    const current = store.getQuery(api.userSettings.getSpeechVoice, {});
    if (current)
      store.setQuery(
        api.userSettings.getSpeechVoice,
        {},
        { ...current, selected: voice },
      );
  });
  const [chooseFailed, setChooseFailed] = useState<string | null>(null);
  const choose = (voice: string) => {
    setChooseFailed(null);
    setVoice({ voice }).catch(() => setChooseFailed(voice));
  };

  const [sampling, setSampling] = useState<Sampling | null>(null);
  const [sampleError, setSampleError] = useState<{
    voice: string;
    message: string;
  } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const tokens = useRef(0);
  const listen = useRef(sample);
  listen.current = sample;
  /** Set when a sample paused Listen, so leaving the voices resumes it. */
  const pausedListen = useRef(false);
  /** Drops a sample still waiting for a slot; one already sent can't be called back. */
  const waiting = useRef<AbortController | null>(null);

  const silence = () => {
    tokens.current += 1;
    nextSample = null;
    waiting.current?.abort();
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setSampling(null);
  };

  // Listen resumed from elsewhere (headphones, the lock screen): the sample
  // gives way, and closing settings no longer has a pause of its own to undo
  const listenPlaying = sample?.listenPlaying ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when Listen starts playing
  useEffect(() => {
    if (!listenPlaying) return;
    pausedListen.current = false;
    if (sampling) silence();
  }, [listenPlaying]);

  // Closing settings or changing tab ends the sample and gives Listen back
  useEffect(
    () => () => {
      tokens.current += 1;
      nextSample = null;
      waiting.current?.abort();
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
      const reader = listen.current;
      if (pausedListen.current && reader?.listenPaused)
        reader.toggleListenPause();
    },
    [],
  );

  const toggleSample = (voice: string) => {
    if (!sample) return;
    if (sampling?.voice === voice) {
      silence();
      return;
    }
    silence();
    setSampleError(null);
    if (sample.listenPlaying) {
      sample.toggleListenPause();
      pausedListen.current = true;
    }
    const token = tokens.current;
    setSampling({ voice, token });
    // Started inside the press, so mobile browsers let it play after the await
    audio.current ??= new Audio();
    audio.current.src = SILENT_CLIP;
    audio.current.play().catch(() => undefined);
    const next = { voice, token, text: sample.text() };
    if (sampleInFlight)
      nextSample = () => {
        if (tokens.current === token) send(next);
      };
    else send(next);
  };

  const send = ({ voice, token, text }: SampleRequest) => {
    const reader = listen.current;
    const element = audio.current;
    if (!reader || !element) return;
    sampleInFlight = true;
    const controller = new AbortController();
    waiting.current = controller;
    trackSpeechRequest(async () => {
      const spoken = prepare ? await prepare(text, controller.signal) : text;
      controller.signal.throwIfAborted();
      return requestSpeechClip({
        articleId: reader.articleId,
        text: spoken,
        voice,
      });
    }, controller.signal)
      .then((bytes) => {
        if (tokens.current !== token) return;
        const clip = URL.createObjectURL(
          new Blob([bytes], { type: "audio/mpeg" }),
        );
        url.current = clip;
        // The priming clip's own end must not count as the sample's
        element.onended = () => {
          if (tokens.current === token && url.current === clip) silence();
        };
        element.src = clip;
        return element.play();
      })
      .catch((error: unknown) => {
        if (tokens.current !== token) return;
        silence();
        setSampleError({
          voice,
          message: failureSentence(error, "The sample couldn't play."),
        });
      })
      .finally(() => {
        sampleInFlight = false;
        const waiting = nextSample;
        nextSample = null;
        waiting?.();
      });
  };

  const voices = choice?.voices ?? [];
  const disabled = noKey || !choice;

  return (
    <div className="mt-4 space-y-3.5">
      <p className="text-[12.5px] leading-relaxed text-[var(--reader-muted)]">
        The voice that reads to you when you press Listen.
      </p>
      <div
        role="radiogroup"
        aria-label="Voice"
        aria-describedby={noKey ? undefined : "listening-sample-hint"}
        aria-disabled={disabled || undefined}
        className={cn("space-y-0.5", noKey && "opacity-50")}
      >
        {voices.map((voice) => {
          const checked = choice?.selected === voice.id;
          const playing = sampling?.voice === voice.id;
          return (
            <div
              key={voice.id}
              className={cn(
                "flex items-center gap-1 rounded-md pr-1 transition-colors",
                checked
                  ? "bg-[var(--reader-chip)]"
                  : "hover:bg-[var(--reader-chip)]",
              )}
            >
              <label className="flex min-h-11 flex-1 min-w-0 cursor-pointer items-center gap-2.5 pl-2.5 sm:min-h-9">
                <input
                  type="radio"
                  name="listening-voice"
                  value={voice.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => choose(voice.id)}
                  onKeyDown={(event) => {
                    // Arrows choose; Space, which would only re-check it, plays it
                    if (event.key !== " ") return;
                    event.preventDefault();
                    toggleSample(voice.id);
                  }}
                  className="accent-[var(--reader-fg)]"
                />
                <span
                  className={cn(
                    "truncate text-[13px]",
                    checked
                      ? "font-semibold text-[var(--reader-fg)]"
                      : "text-[var(--reader-fg-soft)]",
                  )}
                >
                  {voice.name}
                </span>
                <span className="ml-auto shrink-0 text-[11.5px] text-[var(--reader-muted)]">
                  {voice.character}
                </span>
              </label>
              <button
                type="button"
                // Space on the voice plays it, so the buttons stay out of Tab order
                tabIndex={-1}
                disabled={disabled}
                onClick={() => toggleSample(voice.id)}
                aria-label={
                  playing
                    ? `Stop the ${voice.name} sample`
                    : `Play a sample of ${voice.name}`
                }
                aria-pressed={playing}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--reader-fg)] sm:h-8 sm:w-8"
              >
                {playing ? <Square size={12} /> : <Play size={13} />}
              </button>
            </div>
          );
        })}
      </div>
      {speed && (
        <div className="flex items-center gap-2.5 pt-1">
          <label
            htmlFor="listening-speed"
            className="text-[13px] text-[var(--reader-fg-soft)]"
          >
            Speed
          </label>
          <input
            id="listening-speed"
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={SPEED_STEP}
            value={speed.value}
            onChange={(event) => speed.onChange(Number(event.target.value))}
            aria-valuetext={formatSpeed(speed.value)}
            className="reader-range min-w-0 flex-1"
          />
          <output
            htmlFor="listening-speed"
            className="w-11 shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--reader-fg)]"
          >
            {formatSpeed(speed.value)}
          </output>
        </div>
      )}
      {chooseFailed && (
        <InlineError
          message="Couldn't change the voice."
          onRetry={() => choose(chooseFailed)}
        />
      )}
      {sampleError && (
        <InlineError
          message={sampleError.message}
          onRetry={() => toggleSample(sampleError.voice)}
        />
      )}
      {noKey ? (
        <p className="text-[12.5px] leading-relaxed text-[var(--reader-fg-soft)]">
          <Link
            href="/account"
            onClick={onAddKey}
            className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-0"
          >
            Add an OpenRouter key in Your account
          </Link>{" "}
          to use these voices. Without an AI key, the device voice uses basic
          text cleanup only.
        </p>
      ) : (
        <p
          id="listening-sample-hint"
          className="text-[11.5px] leading-relaxed text-[var(--reader-muted)]"
        >
          Uses your OpenRouter key, about 3 cents an hour for any of these
          voices. Play, or Space on a voice, reads the paragraph you're on.
          While listening, the clip playing finishes in the old voice and the
          next one is in the new voice. Your Quick AI model prepares passages
          before this synthetic voice reads them, with additional provider
          charges. Code is explained; images use source descriptions, not
          guessed visual details. The original article stays unchanged.
        </p>
      )}
    </div>
  );
}
