"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { failureSentence } from "./failure-copy";
import { createFollower } from "./listen-follow";
import { buildQueue } from "./listen-queue";
import type { TextPreparer } from "./narration-preparation";
import { getArticleBody, getParagraphs } from "./paragraphs";
import { narrationEntries } from "./spoken-text";
import { trackSpeechRequest } from "./use-natural-voice";

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const lang = document.documentElement.lang || "en";
  const matching = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(lang.slice(0, 2)),
  );
  const pool = matching.length ? matching : voices;
  return (
    pool.find((v) => /natural|premium|enhanced/i.test(v.name)) ??
    pool.find((v) => /google|samantha|daniel/i.test(v.name)) ??
    pool.find((v) => v.default) ??
    pool[0] ??
    null
  );
}

/** Reads the article aloud paragraph by paragraph with the Web Speech API: the device voice (D-TTS-013). */
export function useDeviceVoice(
  containerRef: React.RefObject<HTMLElement | null>,
  articleId?: string,
  unitKey?: string | null,
  content?: string,
  contentHtml?: string,
  speed = 1,
  prepare?: TextPreparer,
) {
  const [state, setState] = useState<{
    index: number | null;
    paused: boolean;
    following: boolean;
    preparing?: boolean;
    error?: string | null;
  }>({ index: null, paused: false, following: true });
  const session = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const preparer = useRef(prepare);
  useEffect(() => {
    preparer.current = prepare;
  }, [prepare]);
  const paused = useRef(false);
  const pendingSpeech = useRef<(() => void) | null>(null);
  const retryPassage = useRef<(() => void) | null>(null);
  const navigation = useRef({ index: 0, count: 0 });
  // An utterance's rate can't change once it is speaking, so a new speed
  // reaches the voice from the next paragraph
  const rate = useRef(speed);
  rate.current = speed;
  const shown = useRef<HTMLElement | undefined>(undefined);
  const follower = useRef<ReturnType<typeof createFollower>>(null);
  follower.current ??= createFollower(() =>
    setState((s) => ({ ...s, following: follower.current?.following ?? true })),
  );
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const clearMark = useCallback(() => {
    for (const el of document.querySelectorAll("[data-speaking]"))
      el.removeAttribute("data-speaking");
  }, []);

  const stop = useCallback(() => {
    session.current += 1;
    controller.current?.abort();
    paused.current = false;
    pendingSpeech.current = null;
    retryPassage.current = null;
    navigation.current = { index: 0, count: 0 };
    if (supported) window.speechSynthesis.cancel();
    clearMark();
    follower.current?.stop();
    shown.current = undefined;
    setState({ index: null, paused: false, following: true });
  }, [supported, clearMark]);

  const speakFrom = useCallback(
    (start: number, entryOverride?: number) => {
      if (!supported) return;
      const body = getArticleBody(containerRef.current);
      const entries = narrationEntries(body, getParagraphs(body));
      const from =
        entryOverride ??
        (start <= 0
          ? 0
          : entries.findIndex(
              (entry) => (entry.sourceEndIndex ?? entry.sourceIndex) >= start,
            ));
      if (from < 0) {
        stop();
        return;
      }
      const queue = buildQueue(
        entries.map((entry) => entry.spoken),
        from,
        document.documentElement.lang || "en",
        undefined,
        1000,
      );
      const token = ++session.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      paused.current = false;
      pendingSpeech.current = null;
      retryPassage.current = null;
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      const voice = pickVoice();
      // A skip within a listen keeps the reader's choice to follow or not
      if (!follower.current?.active) follower.current?.start();

      const speak = async (i: number): Promise<void> => {
        if (token !== session.current) return;
        const item = queue[i];
        const entry = item ? entries[item.block] : undefined;
        if (!entry) {
          stop();
          return;
        }
        const el = entry.element;
        navigation.current = { index: item.block, count: entries.length };
        clearMark();
        el.setAttribute("data-speaking", "");
        shown.current = el;
        follower.current?.reveal(el);
        setState({
          index: entry.sourceIndex,
          paused: false,
          following: follower.current?.following ?? true,
          preparing: Boolean(preparer.current),
        });
        let text: string;
        try {
          const prepareText = preparer.current;
          text = prepareText
            ? await trackSpeechRequest(
                () => prepareText(item.text, abort.signal, item.kind),
                abort.signal,
              )
            : item.kind === "code"
              ? "A code sample appears here. A spoken explanation needs an AI provider key; the original code is on the page."
              : item.text;
        } catch (error) {
          if (token !== session.current || abort.signal.aborted) return;
          retryPassage.current = () => {
            void speak(i);
          };
          setState((state) => ({
            ...state,
            preparing: false,
            error: failureSentence(
              error,
              "This passage couldn't be prepared for listening.",
            ),
          }));
          return;
        }
        if (token !== session.current || abort.signal.aborted) return;
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) utterance.voice = voice;
        utterance.rate = rate.current;
        utterance.onboundary = (event) => {
          if (token !== session.current) return;
          follower.current?.reveal(
            el,
            item.sourceStart +
              (item.sourceEnd - item.sourceStart) *
                Math.min(
                  1,
                  Math.max(0, event.charIndex / Math.max(1, text.length)),
                ),
          );
        };
        utterance.onend = () => {
          void speak(i + 1);
        };
        utterance.onerror = (e) => {
          if (
            token !== session.current ||
            e.error === "interrupted" ||
            e.error === "canceled"
          )
            return;
          retryPassage.current = () => {
            void speak(i);
          };
          setState((state) => ({
            ...state,
            preparing: false,
            error: "The device voice couldn't read this passage. Retry.",
          }));
        };
        const play = () => {
          if (token !== session.current || abort.signal.aborted) return;
          setState((state) => ({ ...state, preparing: false, paused: false }));
          follower.current?.reveal(el, item.sourceStart);
          window.speechSynthesis.speak(utterance);
        };
        if (paused.current) pendingSpeech.current = play;
        else play();
      };
      const first = queue.findIndex((item) => item.block >= from);
      if (first < 0) stop();
      else void speak(first);
    },
    [supported, containerRef, stop, clearMark],
  );

  const togglePause = useCallback(() => {
    if (!supported) return;
    paused.current = !paused.current;
    if (!paused.current && pendingSpeech.current) {
      const play = pendingSpeech.current;
      pendingSpeech.current = null;
      window.speechSynthesis.resume();
      play();
    } else if (!paused.current) window.speechSynthesis.resume();
    else window.speechSynthesis.pause();
    setState((s) => ({ ...s, paused: paused.current }));
  }, [supported]);

  const follow = useCallback(() => follower.current?.follow(shown.current), []);
  const next = useCallback(() => {
    const target = navigation.current.index + 1;
    if (target >= navigation.current.count) stop();
    else speakFrom(0, target);
  }, [speakFrom, stop]);
  const previous = useCallback(
    () => speakFrom(0, Math.max(0, navigation.current.index - 1)),
    [speakFrom],
  );

  // Prose identity, not paragraph geometry or arriving annotations, ends speech.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes invalidate the captured paragraph array
  useEffect(() => {
    stop();
    return stop;
  }, [stop, articleId, unitKey, content, contentHtml]);

  return {
    supported,
    index: state.index,
    paused: state.paused,
    preparing: state.preparing ?? false,
    error: state.error ?? null,
    active: state.index !== null,
    following: state.following,
    follow,
    speakFrom,
    togglePause,
    stop,
    next,
    previous,
    retry: () => retryPassage.current?.(),
  };
}
