import { dayKey, startOfLocalDay } from "@marginalia/backend/reading-pages";
import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The reader's local date, kept current while the room stays open: it changes
 * at local midnight and when the tab becomes visible again (timers are
 * throttled in the background). Queries that read the clock take it as an
 * argument so they run again on a new day.
 */
export function useLocalToday(timeZone?: string) {
  const date = (at: Date) =>
    timeZone ? dayKey(at.getTime(), timeZone) : dateOf(at);
  const [today, setToday] = useState(() => date(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      const day = timeZone ? dayKey(now.getTime(), timeZone) : dateOf(now);
      setToday(day);
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      // A second past, so a timer that fires early still lands on the new day
      const boundary = timeZone
        ? startOfLocalDay(
            Date.parse(`${day}T12:00:00Z`) + 12 * 60 * 60 * 1000,
            timeZone,
          )
        : midnight.getTime();
      timer = setTimeout(refresh, boundary - now.getTime() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeZone]);
  return today;
}
