"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { ReadingCheckpoint } from "@marginalia/backend/reading-activity";
import { dayKey } from "@marginalia/backend/reading-pages";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { drainCheckpoints, queueCheckpoints } from "./checkpoint-queue";
import { type PageCoverageConfig, visiblePageCells } from "./page-coverage";
import { observeParagraphsInView } from "./paragraph-dwell";
import {
  observeParagraphGeometry,
  paragraphGeometry,
} from "./paragraph-geometry";
import { getArticleBody } from "./paragraphs";
import { paragraphAtViewTop } from "./place-restore";
import { articleProgress, ReadingClock } from "./reading-clock";

export function useEngagementTracker({
  articleId,
  sessionId,
  sessionKey,
  requestedMinutes,
  ready,
  containerRef,
  listening,
  paragraphVersion = 0,
  pageSource,
}: {
  articleId: string;
  sessionId: string | null;
  sessionKey?: string | null;
  requestedMinutes?: number;
  ready: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  listening: boolean;
  paragraphVersion?: number;
  pageSource?: PageCoverageConfig;
}) {
  const checkpoint = useMutation(api.readingActivity.checkpoint);
  const clockRef = useRef<ReadingClock | null>(null);
  const flushRef = useRef<((finish?: boolean) => Promise<void>) | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingPageWords, setPendingPageWords] = useState(0);
  // Attribution can resolve late without replacing the clock or crediting elapsed time twice.
  const attribution = useRef({ sessionId, sessionKey, requestedMinutes });
  const speech = useRef(listening);
  const pageConfig = useRef(pageSource);
  useEffect(() => {
    pageConfig.current = pageSource;
  }, [pageSource]);
  const pageSourceId = pageSource?.sourceId;
  const pageTimeZone = pageSource?.timeZone;
  useEffect(() => {
    attribution.current = { sessionId, sessionKey, requestedMinutes };
    speech.current = listening;
  }, [sessionId, sessionKey, requestedMinutes, listening]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: source identity starts a new visit after the legacy-only startup clock
  useEffect(() => {
    if (!ready) return;
    const clock = new ReadingClock(
      Date.now(),
      performance.now(),
      !document.hidden && document.hasFocus(),
      pageTimeZone,
    );
    if (pageConfig.current) clock.configurePages(pageConfig.current);
    clockRef.current = clock;
    clock.speech(speech.current, Date.now(), performance.now());
    const pageVisibility = () =>
      clock.pageVisibility(
        !document.documentElement.hasAttribute("data-notes-open") &&
          !document.documentElement.hasAttribute("data-reader-pane") &&
          !document.querySelector(
            "dialog[open], [role='dialog'][data-state='open']",
          ),
        Date.now(),
        performance.now(),
      );
    const visitId = crypto.randomUUID();
    let finished = false;
    let finishRequested = false;
    let mounted = true;
    let draining: Promise<void> | null = null;
    const identity = { ...attribution.current, sessionKey };
    const sendCheckpoint = async (snapshot: ReadingCheckpoint) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A timed-out mutation may still commit. Keep its queue entry until a
        // later acknowledged retry; cumulative backend checkpoints are idempotent.
        await Promise.race([
          checkpoint(snapshot),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Reading activity hasn't synced yet.")),
              5000,
            );
          }),
        ]);
        // A shared drain can also deliver other visits' durable backlog. Only
        // this visit's successful delivery may prune its clock, never a timeout.
        if (snapshot.visitId === visitId && snapshot.articleId === articleId) {
          clock.acknowledge(snapshot);
          if (mounted && clock.pages)
            setPendingPageWords(
              clock.pages.pending(
                dayKey(Date.now(), clock.pages.config.timeZone),
              ),
            );
        }
      } finally {
        clearTimeout(timer);
      }
    };
    const samples = (finish = false): ReadingCheckpoint[] => {
      pageVisibility();
      return clock
        .snapshots(Date.now(), performance.now())
        .map((s, i, all) => ({
          ...s,
          articleId,
          sessionId: identity.sessionId ?? undefined,
          sessionKey: identity.sessionKey ?? undefined,
          requestedMinutes: identity.requestedMinutes,
          visitId,
          finished: (finish || finishRequested) && i === all.length - 1,
        }));
    };
    const flush = (finish = false): Promise<void> => {
      if (finished) return Promise.resolve();
      // Periodic signals coalesce. Done never joins a non-finishing snapshot:
      // it queues its own cumulative finish after the active request.
      if (draining && !finish) return draining;
      if (finish) finishRequested = true;
      const snapshots = samples(finish);
      queueCheckpoints(snapshots);
      const work = drainCheckpoints(
        sendCheckpoint,
        finish ? snapshots : undefined,
      ).then(
        () => {
          if (finish) finished = true;
          if (mounted) setSaveError(false);
        },
        (error: unknown) => {
          if (mounted) setSaveError(true);
          throw error;
        },
      );
      draining = work;
      void work
        .finally(() => {
          if (draining === work) draining = null;
        })
        .catch(() => {});
      return work;
    };
    flushRef.current = flush;
    const active = () => {
      pageVisibility();
      clock.activity(Date.now(), performance.now());
    };
    const measure = () => {
      const geometry = paragraphGeometry(containerRef.current);
      if (!geometry) return;
      if (clock.pages)
        clock.pages.view(
          visiblePageCells(
            geometry.rects,
            clock.pages.config.paragraphWords,
            window.innerHeight,
          ),
        );
      const p = articleProgress(
        geometry.body.top,
        geometry.body.height,
        window.innerHeight,
      );
      clock.progress(
        p,
        paragraphAtViewTop(geometry.rects.map((rect) => rect.bottom)) ??
          undefined,
      );
      setProgress(p);
    };
    const backgroundFlush = () => {
      if (!finished && navigator.onLine !== false && !document.hidden)
        void flush().catch(() => {});
    };
    const visibility = () => {
      clock.visibility(
        !document.hidden && document.hasFocus(),
        Date.now(),
        performance.now(),
      );
      if (document.hidden) {
        queueCheckpoints(samples());
        if (navigator.onLine !== false) void flush().catch(() => {});
      } else backgroundFlush();
    };
    const leave = () => {
      if (finished) return;
      const snapshots = samples();
      queueCheckpoints(snapshots);
      for (const s of snapshots)
        navigator.sendBeacon?.(
          "/api/engagement",
          new Blob([JSON.stringify(s)], { type: "application/json" }),
        );
    };
    const stopGeometry = observeParagraphGeometry(
      containerRef.current,
      measure,
    );
    backgroundFlush();
    window.addEventListener("scroll", active, { passive: true });
    window.addEventListener("pointerdown", active, { passive: true });
    window.addEventListener("keydown", active);
    window.addEventListener("focus", visibility);
    window.addEventListener("blur", visibility);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", backgroundFlush);
    const tick = window.setInterval(() => {
      pageVisibility();
      clock.heartbeat(Date.now(), performance.now());
      if (clock.pages)
        setPendingPageWords(
          clock.pages.pending(dayKey(Date.now(), clock.pages.config.timeZone)),
        );
    }, 1000);
    const save = window.setInterval(backgroundFlush, 15_000);
    return () => {
      mounted = false;
      if (!finished) {
        queueCheckpoints(samples());
        if (navigator.onLine !== false && !document.hidden)
          void flush().catch(() => {});
      }
      if (clockRef.current === clock) {
        clockRef.current = null;
        flushRef.current = null;
      }
      clearInterval(tick);
      clearInterval(save);
      stopGeometry();
      window.removeEventListener("scroll", active);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      window.removeEventListener("focus", visibility);
      window.removeEventListener("blur", visibility);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", backgroundFlush);
    };
  }, [
    ready,
    articleId,
    sessionKey,
    containerRef,
    checkpoint,
    pageSourceId,
    pageTimeZone,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ready/article changes replace the clock even when the source object is stable
  useEffect(() => {
    const clock = clockRef.current;
    if (!clock || !pageSource) return;
    clock.heartbeat(Date.now(), performance.now());
    clock.configurePages(pageSource);
    const geometry = paragraphGeometry(containerRef.current);
    if (geometry)
      clock.pages?.view(
        visiblePageCells(
          geometry.rects,
          pageSource.paragraphWords,
          window.innerHeight,
        ),
      );
  }, [pageSource, ready, articleId, containerRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: prose epochs replace elements; source epochs replace clocks
  useEffect(() => {
    const body = ready ? getArticleBody(containerRef.current) : null;
    const clock = clockRef.current;
    if (!body || !clock) return;
    const stop = observeParagraphsInView(body, (inView) =>
      clock.paragraphs(inView, Date.now(), performance.now()),
    );
    return () => {
      stop();
      clock.paragraphs([], Date.now(), performance.now());
    };
  }, [
    ready,
    articleId,
    sessionKey,
    containerRef,
    paragraphVersion,
    pageSourceId,
    pageTimeZone,
  ]);
  useEffect(() => {
    clockRef.current?.speech(listening, Date.now(), performance.now());
  }, [listening]);
  const trackAnnotationOpen = useCallback((id: string) => {
    clockRef.current?.annotation(id);
  }, []);
  const finish = useCallback(async () => {
    if (!flushRef.current) throw new Error("Reader is still opening");
    await flushRef.current(true);
  }, []);
  const retry = useCallback(async () => {
    await flushRef.current?.();
  }, []);
  return {
    trackAnnotationOpen,
    finish,
    retry,
    saveError,
    progress,
    pendingPageWords,
  };
}
