"use client";

import { api } from "@marginalia/backend/convex/_generated/api";
import { formatPages } from "@marginalia/backend/reading-pages";
import { useConvexConnectionState, useQuery } from "convex/react";
import { Maximize, Minimize, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePageOverview } from "@/components/page-goal";
import { describeDuration } from "@/lib/reading-sentence";
import styles from "./reading-display.module.css";

const dateAt = (day: string) => new Date(`${day}T12:00:00Z`);
const shortDate = (day: string, weekday: "short" | "long") => {
  const options: Intl.DateTimeFormatOptions = { weekday, timeZone: "UTC" };
  if (weekday === "long") {
    options.day = "numeric";
    options.month = "long";
  }
  return new Intl.DateTimeFormat("en", options).format(dateAt(day));
};

/** A private, read-only live display. The reader remains the source of all activity. */
export function ReadingDisplay() {
  const pages = usePageOverview(30);
  const room = useQuery(
    api.stats.readingRoom,
    pages
      ? { timeZone: pages.timeZone, today: pages.today, period: "30days" }
      : "skip",
  );
  const connection = useConvexConnectionState();
  const [online, setOnline] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [screenMessage, setScreenMessage] = useState("");

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const full = () => setFullscreen(Boolean(document.fullscreenElement));
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("fullscreenchange", full);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("fullscreenchange", full);
    };
  }, []);

  useEffect(() => {
    if (!keepAwake) return;
    let disposed = false;
    let requesting = false;
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (
        document.visibilityState !== "visible" ||
        requesting ||
        (lock && !lock.released)
      )
        return;
      requesting = true;
      try {
        if (!navigator.wakeLock) throw new Error("unsupported");
        const next = await navigator.wakeLock.request("screen");
        if (disposed) await next.release();
        else lock = next;
      } catch {
        if (!disposed) {
          setKeepAwake(false);
          setScreenMessage(
            "This browser couldn't keep the screen on. Check the device's sleep settings.",
          );
        }
      } finally {
        requesting = false;
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [keepAwake]);

  const toggleFullscreen = async () => {
    setScreenMessage("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setScreenMessage(
        "Full screen isn't available here. Use your browser's full-screen mode instead.",
      );
    }
  };

  const today = pages?.history.find((entry) => entry.day === pages.today);
  const words = today?.creditedWords ?? 0;
  const goal = today?.goalWords ?? null;
  const goalVisible = Boolean(pages?.visible && goal !== null);
  const reached = goalVisible && goal !== null && words >= goal;
  const week = pages
    ? Array.from({ length: 7 }, (_, index) => {
        const day = new Date(
          dateAt(pages.today).getTime() - (6 - index) * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        const entry = pages.history.find((item) => item.day === day);
        return {
          day,
          words: entry?.creditedWords ?? 0,
          tracked: pages.trackedFrom !== null && day >= pages.trackedFrom,
        };
      })
    : [];
  const peak = Math.max(300, ...week.map((day) => day.words));
  const connected = online && connection.isWebSocketConnected;

  return (
    <main className={styles.screen} aria-label="Live reading display">
      <div className={styles.sheet}>
        <header className={styles.header}>
          <Link href="/" className={styles.wordmark}>
            Marginalia
          </Link>
          <span className={styles.connection} data-connected={connected}>
            <span aria-hidden="true" />
            {!online
              ? "Offline · saved totals"
              : connected
                ? "Live"
                : "Reconnecting…"}
          </span>
        </header>

        <section className={styles.today} aria-labelledby="display-today">
          <div className={styles.eyebrow}>
            <h1 id="display-today">Today's reading</h1>
            {pages && (
              <time dateTime={pages.today}>
                {shortDate(pages.today, "long")}
              </time>
            )}
          </div>
          <div className={styles.total}>
            <span className={styles.number}>
              {pages ? formatPages(words) : "—"}
            </span>
            <span className={styles.unit}>
              estimated
              <br />
              pages
            </span>
          </div>
          <div className={styles.goalLine}>
            <span>
              {!pages
                ? "Loading your progress…"
                : reached
                  ? "Daily goal reached"
                  : goalVisible && goal !== null
                    ? `${formatPages(Math.max(0, goal - words))} pages to your goal`
                    : pages.visible && !today
                      ? "Preparing today's goal…"
                      : "No daily goal set"}
            </span>
            {goalVisible && goal !== null && (
              <span>
                {formatPages(words)} / {formatPages(goal)}
              </span>
            )}
          </div>
          {goalVisible && goal !== null ? (
            <progress
              className={styles.progress}
              aria-label="Today's estimated page goal"
              max={goal}
              value={Math.min(words, goal)}
            />
          ) : (
            <div className={styles.rule} />
          )}
          {pages?.pendingGoalDay && pages.pendingGoalDay > pages.today && (
            <p className={styles.pending}>
              From {pages.pendingGoalDay}:{" "}
              {pages.pendingGoalWords == null
                ? "goal off"
                : `${formatPages(pages.pendingGoalWords)} pages per day`}
            </p>
          )}
        </section>

        <section className={styles.week} aria-labelledby="display-week">
          <div className={styles.sectionTitle}>
            <h2 id="display-week">The last seven days</h2>
            <span>
              {pages
                ? `${formatPages(week.reduce((sum, day) => sum + day.words, 0))} pages`
                : "—"}
            </span>
          </div>
          <ol className={styles.books} aria-label="Daily estimated pages">
            {week.map((day) => (
              <li key={day.day} data-today={day.day === pages?.today}>
                <span className={styles.dayValue}>
                  {day.tracked ? formatPages(day.words) : "—"}
                </span>
                <div
                  className={styles.book}
                  aria-hidden="true"
                  data-tracked={day.tracked}
                >
                  <span
                    style={{
                      height: `${Math.max(day.words > 0 ? 4 : 0, (day.words / peak) * 100)}%`,
                    }}
                  />
                </div>
                <time dateTime={day.day}>{shortDate(day.day, "short")}</time>
                <span className="sr-only">
                  {day.tracked ? "estimated pages" : "Not tracked"}
                </span>
              </li>
            ))}
          </ol>
          {!pages && (
            <p role="status" className={styles.pending}>
              Loading daily history…
            </p>
          )}
        </section>

        <section className={styles.stats} aria-labelledby="display-stats">
          <h2 id="display-stats">Last 30 days</h2>
          <dl>
            <div>
              <dt>Reading time</dt>
              <dd>{room ? describeDuration(room.activeTimeMs) : "—"}</dd>
            </div>
            <div>
              <dt>Days with reading</dt>
              <dd>
                {room ? room.readingDays : "—"}
                <span> / 30</span>
              </dd>
            </div>
          </dl>
          {room?.partial && (
            <p className={styles.pending}>
              Time and days reflect the most recent retained visits.
            </p>
          )}
        </section>

        <footer className={styles.footer}>
          <div className={styles.controls}>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              <span className="sr-only">
                {fullscreen ? "Exit full screen" : "Full screen"}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={keepAwake}
              onClick={() => {
                setScreenMessage("");
                setKeepAwake((value) => !value);
              }}
            >
              {keepAwake ? <Sun size={16} /> : <Moon size={16} />}
              <span>Keep screen on</span>
            </button>
            <Link href="/reading">Goals & stats ↗</Link>
          </div>
          {screenMessage && (
            <p role="status" className={styles.pending}>
              {screenMessage}
            </p>
          )}
          <p className={styles.finePrint}>
            300 words = 1 estimated page{pages ? ` · ${pages.timeZone}` : ""}
            <br />
            Only saved reading counts.{" "}
            {pages?.trackedFrom
              ? `Page tracking from ${pages.trackedFrom}.`
              : "Earlier pages weren't tracked."}
          </p>
        </footer>
      </div>
    </main>
  );
}
