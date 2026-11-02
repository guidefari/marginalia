"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Skeleton, SkeletonBar } from "@/components/in-place";
import {
  PERIOD_LABELS,
  PERIODS,
  type RoomPeriod,
  readingSentence,
} from "@/lib/reading-sentence";
import { PageGoalTracker } from "../page-goal";
import { ArticleEngagement } from "./article-engagement";
import { HowYouRead } from "./how-you-read";
import { ShortAndLong } from "./short-and-long";
import { TagMergeSuggestion } from "./tag-merge-suggestion";
import { TopicMap } from "./topic-map";
import { useLocalToday } from "./use-local-today";
import { WhenYouRead } from "./when-you-read";
import { WhereYouLinger } from "./where-you-linger";
import { YourSources } from "./your-sources";

/** A mirror of reading, with an optional estimated-page goal; no streaks or nudges. */
export function StatsTab() {
  const [period, setPeriod] = useState<RoomPeriod>("month");
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const today = useLocalToday();
  const room = useQuery(api.stats.readingRoom, { timeZone, period, today });
  const engagement = useQuery(api.stats.readingEngagement, {
    timeZone,
    period,
    today,
  });
  const topics = useQuery(api.stats.readingTopics, {
    timeZone,
    period,
    today,
  });

  const habits = useQuery(api.readingHabits.readingHabits, {
    timeZone,
    period,
    today,
  });
  const linger = useQuery(api.readingHabits.readingLinger, {
    timeZone,
    period,
    today,
  });

  const merges = useQuery(api.tagMerge.pending);
  // One at a time: deciding this one brings up the next
  const merge = merges?.[0];

  return (
    <div>
      <PageGoalTracker
        days={period === "90days" ? 90 : period === "30days" ? 30 : "month"}
      />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {room ? (
          <p className="max-w-[860px] font-serif text-[clamp(1.5rem,3vw,2.125rem)] font-light leading-snug">
            {readingSentence({
              period,
              activeTimeMs: room.activeTimeMs,
              readingDays: room.readingDays,
              heat: room.heat,
              shortSlots: room.shortSlots,
              longSlots: room.longSlots,
            })}
          </p>
        ) : (
          <Skeleton
            label="Loading your reading"
            className="w-full max-w-[860px]"
          >
            <SkeletonBar className="h-8 w-full" />
            <SkeletonBar className="mt-3 h-8 w-[60%]" />
          </Skeleton>
        )}
        <label className="relative shrink-0 text-sm text-[var(--reader-muted)]">
          <span className="sr-only">Period</span>
          <select
            className="min-h-11 cursor-pointer appearance-none bg-transparent py-2 pr-5 text-sm text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
            value={period}
            onChange={(e) => {
              const next = PERIODS.find((p) => p === e.target.value);
              if (next) setPeriod(next);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2"
          >
            ▾
          </span>
        </label>
      </div>

      {room && (
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <WhenYouRead heat={room.heat} timeZone={timeZone} />
            <ShortAndLong weekday={room.weekday} weekend={room.weekend} />
            {habits && <HowYouRead habits={habits} />}
          </div>
          <div className="space-y-9">
            {topics && (
              <TopicMap
                topics={topics}
                paired={merge ? [merge.into, merge.from] : []}
              />
            )}
            {merge && <TagMergeSuggestion suggestion={merge} />}
            {linger && <WhereYouLinger topics={linger.topics} />}
            <YourSources feeds={room.feeds} />
          </div>
        </div>
      )}

      {(habits?.partial || linger?.partial) && (
        <p role="status" className="mt-8 text-xs text-[var(--reader-muted)]">
          {[
            habits?.partial && "How you read",
            linger?.partial && "Where you linger",
          ]
            .filter(Boolean)
            .join(" and ")}{" "}
          counts your most recent activity only. Choose a shorter period for all
          of it.
        </p>
      )}
      {room && (room.partial || room.readsPartial) && (
        <p role="status" className="mt-8 text-xs text-[var(--reader-muted)]">
          {room.partial
            ? "This period has more visits than the room reads, so it shows the most recent ones. Choose a shorter period for every visit."
            : "Short against long counts your most recent reads only."}
        </p>
      )}
      <ArticleEngagement report={engagement} period={period} />
    </div>
  );
}
