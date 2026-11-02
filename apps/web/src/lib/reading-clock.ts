import type { PageCredit } from "@marginalia/backend/reading-activity";
import { capDwell } from "@marginalia/backend/reading-activity";
import { dayKey, startOfLocalDay } from "@marginalia/backend/reading-pages";
import { PageCoverageClock, type PageCoverageConfig } from "./page-coverage";

export const READING_IDLE_MS = 90_000;
export interface ReadingSample {
  day: string;
  startedAt: number;
  updatedAt: number;
  activeTimeMs: number;
  visibleTimeMs: number;
  timeSpentMs: number;
  maxScrollPercent: number;
  /** Paragraph at the top of the view at maxScrollPercent */
  paragraphIndex?: number;
  annotationsOpened: string[];
  /** Active milliseconds per displayed paragraph number */
  dwell: Record<string, number>;
  /** Active time not yet credited to the paragraphs on screen */
  dwellPending: number;
}
export type ReadingSnapshot = Omit<ReadingSample, "dwell" | "dwellPending"> & {
  dwell?: Record<string, number>;
  pageCredit?: PageCredit;
};
export function articleProgress(
  top: number,
  height: number,
  viewport: number,
  header = 64,
) {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const available = Math.max(1, viewport - header - 24);
  if (height <= available) return top + height <= viewport - 24 ? 100 : 0;
  return Math.round(
    Math.min(100, Math.max(0, ((header - top) / (height - available)) * 100)),
  );
}
function localDay(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export class ReadingClock {
  private samples = new Map<string, ReadingSample>();
  private lastAt: number;
  private lastTick: number;
  private lastActivity: number;
  private visible: boolean;
  private listening = false;
  private pageVisible = true;
  private inView: readonly number[] = [];
  pages: PageCoverageClock | null = null;
  private timeZone: string | undefined;
  configurePages(config: PageCoverageConfig) {
    if (this.pages?.config.sourceId === config.sourceId) return;
    this.timeZone = config.timeZone;
    this.pages = new PageCoverageClock(config);
  }
  private day(at: number) {
    return this.timeZone ? dayKey(at, this.timeZone) : localDay(at);
  }
  constructor(at: number, tick: number, visible: boolean, timeZone?: string) {
    this.timeZone = timeZone;
    this.lastAt = at;
    this.lastTick = tick;
    this.lastActivity = tick;
    this.visible = visible;
    this.sample(at);
  }
  private sample(at: number) {
    const day = this.day(at);
    let s = this.samples.get(day);
    if (!s) {
      s = {
        day,
        startedAt: at,
        updatedAt: at,
        activeTimeMs: 0,
        visibleTimeMs: 0,
        timeSpentMs: 0,
        maxScrollPercent: 0,
        annotationsOpened: [],
        dwell: {},
        dwellPending: 0,
      };
      this.samples.set(day, s);
    }
    return s;
  }
  tick(at: number, tick: number) {
    const elapsed = Math.max(
      0,
      Math.min(tick - this.lastTick, at - this.lastAt),
    );
    // A suspended timer is not evidence of foreground reading.
    const visible = this.visible && elapsed <= 5000 ? elapsed : 0;
    const active = this.listening
      ? visible
      : Math.min(
          visible,
          Math.max(0, this.lastActivity + READING_IDLE_MS - this.lastTick),
        );
    let from = this.lastAt;
    const totalWall = Math.max(0, at - from);
    while (from < at) {
      const midnight = new Date(from);
      midnight.setHours(24, 0, 0, 0);
      const boundary = this.timeZone
        ? startOfLocalDay(
            Date.parse(`${this.day(from)}T12:00:00Z`) + 12 * 60 * 60 * 1000,
            this.timeZone,
          )
        : midnight.getTime();
      const end = Math.min(at, boundary);
      const s = this.sample(from);
      const share = totalWall ? (end - from) / totalWall : 0;
      s.timeSpentMs += end - from;
      s.visibleTimeMs += visible * share;
      s.activeTimeMs += active * share;
      // Audio can keep the legacy clock active, but does not qualify visible text.
      if (!this.listening && this.pageVisible)
        this.pages?.credit(active * share, s.day);
      // Dwell takes the active share, so it stops when the tab is hidden, the
      // window loses focus or the reader goes idle, exactly as active time does.
      // It is only totalled here; the paragraphs are credited by `creditDwell`.
      s.dwellPending += active * share;
      s.updatedAt = end;
      from = end;
    }
    this.lastAt = Math.max(this.lastAt, at);
    this.lastTick = tick;
  }
  /**
   * Hands the active time gathered since the last credit to the paragraphs
   * on screen. Called when the set changes, on the timer and before a
   * snapshot, never from scroll or input, which only call `tick`.
   */
  creditDwell() {
    for (const s of this.samples.values()) {
      if (s.dwellPending > 0)
        for (const paragraph of this.inView)
          s.dwell[paragraph] = (s.dwell[paragraph] ?? 0) + s.dwellPending;
      s.dwellPending = 0;
    }
  }
  /** The once-a-second timer: advances the clock and credits paragraph dwell. */
  heartbeat(at: number, tick: number) {
    this.tick(at, tick);
    this.creditDwell();
  }
  activity(at: number, tick: number) {
    this.tick(at, tick);
    this.lastActivity = tick;
  }
  visibility(visible: boolean, at: number, tick: number) {
    this.tick(at, tick);
    this.visible = visible;
    if (visible) this.lastActivity = tick;
  }
  speech(listening: boolean, at: number, tick: number) {
    this.tick(at, tick);
    this.listening = listening;
  }
  /** Open reading panes may cover the prose while legacy activity still counts. */
  pageVisibility(visible: boolean, at: number, tick: number) {
    if (!visible) this.pageVisible = false;
    this.tick(at, tick);
    this.pageVisible = visible;
  }
  /** Sets which paragraphs are on screen; time up to now goes to the previous set. */
  paragraphs(inView: readonly number[], at: number, tick: number) {
    this.heartbeat(at, tick);
    this.inView = [...inView];
  }
  progress(percent: number, paragraphIndex?: number) {
    const s = this.sample(this.lastAt);
    const clamped = Math.min(100, Math.max(0, percent));
    // The paragraph is the one at the furthest point, so scrolling back up
    // leaves it where it was
    if (clamped >= s.maxScrollPercent) s.paragraphIndex = paragraphIndex;
    s.maxScrollPercent = Math.max(s.maxScrollPercent, clamped);
  }
  annotation(id: string) {
    const s = this.sample(this.lastAt);
    if (!s.annotationsOpened.includes(id) && s.annotationsOpened.length < 128)
      s.annotationsOpened.push(id);
  }
  snapshots(at: number, tick: number): ReadingSnapshot[] {
    this.heartbeat(at, tick);
    return [...this.samples.values()].map(
      ({ dwell, dwellPending: _, ...s }) => ({
        ...s,
        annotationsOpened: [...s.annotationsOpened],
        dwell: capDwell(dwell),
        pageCredit: this.pages?.snapshot(s.day),
      }),
    );
  }
  /** Prune only a closed day whose complete cumulative state was delivered. */
  acknowledge(sent: ReadingSnapshot) {
    if (sent.pageCredit) this.pages?.acknowledge(sent.day, sent.pageCredit);
    const sample = this.samples.get(sent.day);
    if (!sample || sent.day === this.day(this.lastAt)) return;
    const pageCredit = this.pages?.snapshot(sent.day);
    const annotations = new Set(sent.annotationsOpened);
    if (
      sample.startedAt !== sent.startedAt ||
      sample.updatedAt > sent.updatedAt ||
      sample.activeTimeMs > sent.activeTimeMs ||
      sample.visibleTimeMs > sent.visibleTimeMs ||
      sample.timeSpentMs > sent.timeSpentMs ||
      sample.maxScrollPercent > sent.maxScrollPercent ||
      sample.paragraphIndex !== sent.paragraphIndex ||
      sample.annotationsOpened.some((id) => !annotations.has(id)) ||
      (pageCredit !== undefined &&
        pageCredit.coverage !== sent.pageCredit?.coverage) ||
      sample.dwellPending > 0 ||
      Object.entries(capDwell(sample.dwell) ?? {}).some(
        ([key, ms]) => ms > (sent.dwell?.[key] ?? 0),
      )
    )
      return;
    this.samples.delete(sent.day);
    this.pages?.forgetDay(sent.day);
  }
}
