"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { observeParagraphGeometry } from "./paragraph-geometry";
import { useBibleDisplay } from "./use-bible-display";

/** `?unit=` as a part number counted from 0, or null when absent or not a number. */
export function parseUnit(value: string | null): number | null {
  return value !== null && /^\d{1,5}$/.test(value) ? Number(value) : null;
}

/**
 * The article the reader shows. An ordinary article is returned as it is. A
 * book's row holds no text, so it is returned with the text, length and
 * annotation status of the one part being read; `unitIndex` says which.
 *
 * The part opened by default is the one the desk would offer next, read once:
 * finishing a part moves "next" on, and the page must not jump with it.
 */
export function useReadable(
  articleId: Id<"articles">,
  unitParam: string | null,
) {
  const requested = parseUnit(unitParam);
  type Bootstrap = NonNullable<
    FunctionReturnType<typeof api.readerBootstrap.get>
  >;
  const [first, setFirst] = useState<{
    id: string;
    unit: number;
    data: Bootstrap;
  } | null>(null);
  const chosen =
    requested ?? (first?.id === articleId ? first.unit : undefined);
  const fetched = useQuery(api.readerBootstrap.get, {
    articleId,
    unitIndex: chosen,
  });
  // Locking the default changes query arguments, not the already readable text.
  // A missing/revoked result (null), unlike a pending subscription, never reuses it.
  const result =
    fetched === undefined && first?.id === articleId && chosen === first.unit
      ? first.data
      : fetched;
  // Freeze the default in render as soon as the first text arrives. Progress
  // updates cannot select another part between effects or after finishing it.
  if (result?.isBook && result.unitIndex !== null && first?.id !== articleId)
    setFirst({ id: articleId, unit: result.unitIndex, data: result });
  const isBook = result?.isBook ?? false;
  const book = useQuery(
    api.readerBootstrap.outline,
    isBook ? { articleId } : "skip",
  );
  const furthest = useQuery(
    api.readerBootstrap.progress,
    isBook ? { articleId } : "skip",
  );
  const bibleDisplay = useBibleDisplay(result?.article);

  return {
    article: bibleDisplay.article,
    sourceArticle: result?.article,
    readingTimeZone: result?.readingTimeZone,
    bibleDisplay,
    scopeReady: Boolean(result?.article),
    isBook,
    unitIndex: result?.unitIndex ?? null,
    unitTitle: result?.unitTitle ?? undefined,
    /** Identity of the part whose text is on screen */
    unitKey: result?.unitKey ?? undefined,
    outline: book?.outline,
    /** The part and percent the reader got furthest to, for resuming within it */
    furthest: furthest ?? undefined,
    /** Each part's one-line summary by part, null until written */
    summaries: book?.summaries,
    /** A part that doesn't exist (a stale link): the reader falls back to the first. */
    missingUnit: result?.missingUnit ?? false,
  };
}

/**
 * Tells the server where the reader is in a part: on opening it (which starts
 * the part's margin) and as they get further, in steps of five percent so a
 * scroll doesn't become a write per frame.
 *
 * The position is measured here, from the part's own text, and keyed by the
 * part: after Next the old part's 95% is never recorded against the new one.
 * `unitKey` is the stored unit's identity, set only once its text is the text
 * on screen, and `measure` reads the percentage scrolled from the page.
 */
export function useBookProgress(
  articleId: Id<"articles">,
  unitIndex: number | null,
  unitKey: string | undefined,
  measure: (
    lastBucket: number,
  ) => { percent: number; paragraphIndex?: number } | null,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const record = useMutation(api.books.recordProgress);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useEffect(() => {
    if (unitIndex === null || !unitKey) return;
    let last = -1;
    let cancelled = false;
    const send = () => {
      if (cancelled) return;
      const at = measureRef.current(last);
      // Nothing is recorded until the part's text has been measured
      if (at === null) return;
      const { percent, paragraphIndex } = at;
      const step = Math.min(100, Math.floor(percent / 5) * 5);
      if (step === last) return;
      const sent = last;
      last = step;
      record({
        articleId,
        unitIndex,
        unitKey,
        scrollPercent: step,
        paragraphIndex,
      }).catch(() => {
        // Reading goes on; the next step tries again
        if (last === step) last = sent;
      });
    };
    // After the part's text has been laid out
    const stop = observeParagraphGeometry(containerRef.current, send);
    return () => {
      cancelled = true;
      stop();
    };
  }, [articleId, unitIndex, unitKey, record, containerRef]);
}
