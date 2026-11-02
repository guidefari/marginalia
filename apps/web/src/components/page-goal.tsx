"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { formatPages } from "@marginalia/backend/reading-pages";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocalToday } from "./reading-room/use-local-today";

export function usePageOverview(days = 30) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const enabled = isAuthenticated && !isLoading;
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const today = useLocalToday(timeZone);
  const overview = useQuery(
    api.readingPages.overview,
    enabled ? { timeZone, today, days } : "skip",
  );
  const data = enabled ? overview : undefined;
  useEffect(() => {
    if (data?.timeZone) setTimeZone(data.timeZone);
  }, [data?.timeZone]);
  return data;
}

/** Lives beside the existing root toast so Done can navigate without losing feedback. */
export function PageGoalCelebration() {
  const data = usePageOverview(1);
  const initialize = useMutation(api.readingPages.initializeDay);
  const claim = useMutation(api.readingPages.claimCelebration);
  const previous = useRef<{
    day: string;
    words: number;
    goal: number | null;
    visible: boolean;
  } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const today = data?.today;
  const zone = data?.timeZone;
  const initialized = Boolean(
    data?.history.some((entry) => entry.day === today),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is an explicit user-requested attempt epoch
  useEffect(() => {
    if (initialized) {
      setError(false);
      return;
    }
    if (!today || !zone) return;
    let disposed = false;
    void initialize({ timeZone: zone })
      .then(() => {
        if (!disposed) setError(false);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
    };
  }, [today, zone, initialized, initialize, retry]);
  useEffect(() => {
    if (!data) {
      previous.current = null;
      return;
    }
    const row = data.history.find((entry) => entry.day === data.today);
    const next = {
      day: data.today,
      words: row?.creditedWords ?? 0,
      goal: row?.goalWords ?? null,
      visible: data.visible,
    };
    const old = previous.current;
    previous.current = next;
    if (
      !old ||
      old.day !== next.day ||
      !old.visible ||
      !next.visible ||
      old.goal !== next.goal ||
      next.goal === null ||
      old.words >= next.goal ||
      next.words < next.goal
    )
      return;
    void claim({ day: next.day })
      .then((claimed) => {
        if (claimed)
          toast.success(
            `Daily goal reached. ${formatPages(next.words)} estimated pages today.`,
            { id: `page-goal:${next.day}` },
          );
      })
      .catch(() => {
        /* Achievement remains visible; do not replay an old celebration. */
      });
  }, [data, claim]);
  return data && error ? (
    <p role="status" className="px-4 py-2 text-xs text-[var(--ink-muted)]">
      Daily page tracking could not start.{" "}
      <button
        type="button"
        className="underline"
        onClick={() => setRetry((n) => n + 1)}
      >
        Retry
      </button>
    </p>
  ) : null;
}

export function ReaderPageGoal({
  pendingWords,
  savingError,
}: {
  pendingWords: number;
  savingError: boolean;
}) {
  const data = usePageOverview(1);
  if (!data?.visible) return null;
  const row = data.history.find((entry) => entry.day === data.today);
  const words = row?.creditedWords ?? 0;
  const goal = row?.goalWords;
  const achieved = goal != null && words >= goal;
  return (
    <span
      className="block truncate font-sans text-[11px] tabular-nums text-[var(--ink-muted)]"
      title="Estimated pages: 300 words per page. Newly qualified text counts once."
    >
      {achieved ? "✓ " : ""}
      {formatPages(words)}
      {goal != null ? ` / ${formatPages(goal)}` : ""} pages today
      {achieved ? " · Goal reached" : ""}
      {savingError
        ? " · Not synced"
        : pendingWords > 0
          ? ` · +${formatPages(pendingWords)} Saving`
          : ""}
    </span>
  );
}

/** Exact ledger, independent of the older Stats report's visit/byte limits. */
export function PageGoalTracker({ days }: { days: number | "month" }) {
  const data = usePageOverview(days === "month" ? 31 : days);
  const save = useMutation(api.readingPages.setGoal);
  const [pages, setPages] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [attemptedGoal, setAttemptedGoal] = useState<number | null>(10);
  if (!data)
    return (
      <p className="mb-8 text-sm text-[var(--reader-muted)]">
        Loading estimated pages…
      </p>
    );
  const row = data.history.find((entry) => entry.day === data.today);
  const historyDays = days === "month" ? Number(data.today.slice(-2)) : days;
  const words = row?.creditedWords ?? 0;
  const goal = row?.goalWords ?? null;
  const achieved = goal !== null && words >= goal;
  const update = async (value: number | null) => {
    setAttemptedGoal(value);
    setBusy(true);
    setError(null);
    try {
      await save({ pages: value, timeZone: data.timeZone });
      setEditing(false);
    } catch {
      setError("The daily goal was not saved. Check the value and retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-labelledby="estimated-pages-heading"
      className="mb-10 border-b border-[var(--reader-border)] pb-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="estimated-pages-heading"
          className="font-serif text-2xl font-light"
        >
          Estimated pages
        </h2>
        <button
          type="button"
          className="min-h-11 text-sm underline underline-offset-4"
          onClick={() => {
            setPages(
              String((data.pendingGoalWords ?? data.goalWords ?? 3000) / 300),
            );
            setEditing(!editing);
          }}
        >
          {data.visible ? "Edit daily goal" : "Set a daily goal"}
        </button>
      </div>
      <p className="mt-2 font-serif text-xl tabular-nums">
        {formatPages(words)}
        {data.visible && goal !== null ? ` of ${formatPages(goal)}` : ""} pages
        today{data.visible && achieved ? " · ✓ Goal reached" : ""}
      </p>
      {data.visible && goal !== null && (
        <progress
          className="mt-3 h-1 w-full accent-[var(--reader-fg)]"
          aria-label="Daily estimated page goal"
          aria-valuetext={`${formatPages(words)} of ${formatPages(goal)} estimated pages`}
          max={goal}
          value={Math.min(words, goal)}
        />
      )}
      {editing && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void update(Number(pages));
          }}
        >
          <label className="text-sm">
            Pages per day
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              required
              value={pages}
              onChange={(event) => setPages(event.target.value)}
              className="mt-1 block min-h-11 w-28 rounded-md border border-[var(--reader-border)] bg-transparent px-3"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-md border border-[var(--reader-border)] px-4 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save goal"}
          </button>
          {data.visible && (
            <button
              type="button"
              disabled={busy}
              className="min-h-11 px-2 text-sm underline"
              onClick={() => void update(null)}
            >
              Turn off
            </button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}{" "}
          <button
            type="button"
            disabled={busy}
            className="underline"
            onClick={() => void update(attemptedGoal)}
          >
            Retry
          </button>
        </p>
      )}
      {data.pendingGoalDay && data.pendingGoalDay > data.today && (
        <p className="mt-2 text-xs text-[var(--reader-muted)]">
          From {data.pendingGoalDay}:{" "}
          {data.pendingGoalWords === null
            ? "goal off"
            : `${formatPages(data.pendingGoalWords ?? 0)} pages per day`}
          . Turning off hides goal feedback now; today’s target stays in
          history.
        </p>
      )}
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[var(--reader-muted)]">
        300 words count as one estimated page. Newly qualified visible article
        text counts once, including partial articles; rereading and listening
        alone do not add pages. Books are not counted yet. Tracking began{" "}
        {data.trackedFrom ?? "with this visit"}; earlier pages were not tracked.
        Dates use {data.timeZone}. Offline reading keeps its recorded date and
        the target known on that device.
      </p>
      <details className="mt-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-2">
          Daily history ·{" "}
          {days === "month" ? "this month" : `last ${days} days`}
        </summary>
        <ol className="mt-2 max-h-72 overflow-y-auto divide-y divide-[var(--reader-border)]">
          {Array.from({ length: historyDays }, (_, index) => {
            const day = new Date(
              Date.parse(`${data.today}T12:00:00Z`) - index * 86_400_000,
            )
              .toISOString()
              .slice(0, 10);
            const entry = data.history.find((item) => item.day === day);
            const tracked =
              data.trackedFrom !== null && day >= data.trackedFrom;
            return (
              <li
                key={day}
                className="flex flex-wrap justify-between gap-x-4 py-2 tabular-nums"
              >
                <time dateTime={day}>{day}</time>
                <span>
                  {!tracked
                    ? "Not tracked"
                    : `${formatPages(entry?.creditedWords ?? 0)} pages`}
                  {tracked && entry?.goalWords != null
                    ? ` / ${formatPages(entry.goalWords)}${entry.creditedWords >= entry.goalWords ? " · ✓ Reached" : ""}`
                    : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
