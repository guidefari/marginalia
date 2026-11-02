import { describe, expect, it, vi } from "vitest";
import { articleProgress, ReadingClock } from "./reading-clock";

const start = new Date(2026, 9, 12, 12).getTime();
describe("recorded reading time", () => {
  it("never rebuckets an existing sample when late page metadata has a different timezone", () => {
    const at = Date.parse("2026-11-02T04:59:58Z");
    const clock = new ReadingClock(at, 0, true, "UTC");
    const startup = clock.snapshots(at, 0)[0];
    clock.heartbeat(at + 1000, 1000);
    expect(
      clock.configurePages({
        sourceId: "source",
        coverage: "0",
        paragraphWords: [8],
        timeZone: "America/New_York",
        goalWords: 3000,
      }),
    ).toBe(false);
    expect(clock.snapshots(at + 2000, 2000)).toMatchObject([
      {
        day: "2026-11-02",
        startedAt: startup.startedAt,
        activeTimeMs: 2000,
        timeSpentMs: 2000,
      },
    ]);
    expect(clock.pages).toBeNull();
  });
  it("pauses at the idle boundary and resumes only with activity", () => {
    const clock = new ReadingClock(start, 0, true);
    for (let tick = 1000; tick <= 100000; tick += 1000)
      clock.tick(start + tick, tick);
    expect(clock.snapshots(start + 100000, 100000)[0]).toMatchObject({
      activeTimeMs: 90000,
      visibleTimeMs: 100000,
      timeSpentMs: 100000,
    });
    clock.activity(start + 100000, 100000);
    expect(clock.snapshots(start + 101000, 101000)[0].activeTimeMs).toBe(91000);
  });
  it("doesn't count hidden tabs or suspended timers as reading", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.visibility(false, start + 1000, 1000);
    clock.tick(start + 60000, 60000);
    clock.visibility(true, start + 60000, 60000);
    clock.tick(start + 120000, 120000);
    expect(clock.snapshots(start + 120000, 120000)[0]).toMatchObject({
      activeTimeMs: 1000,
      visibleTimeMs: 1000,
      timeSpentMs: 120000,
    });
  });
  it("counts visible listening after the idle timeout, not background listening", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.speech(true, start, 0);
    for (let tick = 1000; tick <= 100000; tick += 1000)
      clock.tick(start + tick, tick);
    clock.visibility(false, start + 100000, 100000);
    expect(clock.snapshots(start + 101000, 101000)[0].activeTimeMs).toBe(
      100000,
    );
  });
  it("splits a reading visit at local midnight without losing or duplicating time", () => {
    const midnight = new Date(2026, 9, 13).getTime();
    const clock = new ReadingClock(midnight - 500, 0, true);
    const samples = clock.snapshots(midnight + 500, 1000);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.activeTimeMs)).toEqual([500, 500]);
    expect(samples.map((s) => s.day)).toEqual(["2026-10-12", "2026-10-13"]);
  });
  it("prunes an acknowledged closed day but keeps the current cumulative sample", () => {
    const midnight = new Date(2026, 9, 13).getTime();
    const clock = new ReadingClock(midnight - 500, 0, true);
    clock.paragraphs([1], midnight - 500, 0);
    const [past, current] = clock.snapshots(midnight + 500, 1000);
    clock.acknowledge(past);
    clock.acknowledge(current);
    expect(clock.snapshots(midnight + 1500, 2000)).toMatchObject([
      { day: "2026-10-13", activeTimeMs: 1500 },
    ]);
  });
  it("does not prune a closed day's newer time, progress, annotation or dwell state", () => {
    const midnight = new Date(2026, 9, 13).getTime();
    const clock = new ReadingClock(midnight - 2000, 0, true);
    clock.paragraphs([1], midnight - 2000, 0);
    clock.annotation("kept");
    clock.progress(80, 2);
    const [past] = clock.snapshots(midnight + 500, 2500);
    for (const stale of [
      { ...past, updatedAt: past.updatedAt - 1 },
      { ...past, activeTimeMs: past.activeTimeMs - 1 },
      { ...past, visibleTimeMs: past.visibleTimeMs - 1 },
      { ...past, timeSpentMs: past.timeSpentMs - 1 },
      { ...past, maxScrollPercent: 79 },
      { ...past, paragraphIndex: 1 },
      { ...past, annotationsOpened: [] },
      { ...past, dwell: { "1": 1000 } },
    ]) {
      clock.acknowledge(stale);
      expect(clock.snapshots(midnight + 500, 2500)).toHaveLength(2);
    }
    clock.acknowledge(past);
    expect(clock.snapshots(midnight + 500, 2500)).toHaveLength(1);
  });
  it("keeps annotation opens unique and progress bounded for short articles", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.annotation("one");
    clock.annotation("one");
    clock.progress(80);
    clock.progress(20);
    expect(clock.snapshots(start, 0)[0]).toMatchObject({
      annotationsOpened: ["one"],
      maxScrollPercent: 80,
    });
    expect(articleProgress(64, 400, 800)).toBe(100);
    expect(articleProgress(64, 0, 800)).toBe(0);
    expect(articleProgress(-10000, 2000, 800)).toBe(100);
    expect(articleProgress(400, 2000, 800)).toBe(0);
  });
});

describe("paragraph dwell", () => {
  const dwell = (clock: ReadingClock, ms: number) =>
    clock.snapshots(start + ms, ms)[0].dwell;
  it("credits only the paragraphs on screen, up to the moment the set changes", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs([1, 2], start, 0);
    for (let t = 1000; t <= 5000; t += 1000) clock.heartbeat(start + t, t);
    clock.paragraphs([2, 3], start + 5000, 5000);
    for (let t = 6000; t <= 8000; t += 1000) clock.heartbeat(start + t, t);
    expect(dwell(clock, 8000)).toEqual({ 1: 5000, 2: 8000, 3: 3000 });
  });
  it("is cumulative, so repeated snapshots never add up twice", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs([4], start, 0);
    for (let t = 1000; t <= 3000; t += 1000) clock.heartbeat(start + t, t);
    expect(dwell(clock, 3000)).toEqual({ 4: 3000 });
    expect(dwell(clock, 3000)).toEqual({ 4: 3000 });
    expect(dwell(clock, 4000)).toEqual({ 4: 4000 });
  });
  it("stops while the tab is hidden or the window loses focus, and resumes after", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs([1], start, 0);
    clock.heartbeat(start + 2000, 2000);
    clock.visibility(false, start + 2000, 2000);
    clock.heartbeat(start + 4000, 4000);
    clock.heartbeat(start + 6000, 6000);
    clock.visibility(true, start + 6000, 6000);
    clock.heartbeat(start + 8000, 8000);
    expect(dwell(clock, 8000)).toEqual({ 1: 4000 });
  });
  it("stops at the idle boundary and resumes with activity", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs([1], start, 0);
    for (let t = 1000; t <= 100000; t += 1000) clock.heartbeat(start + t, t);
    expect(dwell(clock, 100000)).toEqual({ 1: 90000 });
    clock.activity(start + 100000, 100000);
    expect(dwell(clock, 102000)).toEqual({ 1: 92000 });
  });
  it("records nothing for paragraphs held under a second or when none is on screen", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs([1], start, 0);
    clock.heartbeat(start + 900, 900);
    clock.paragraphs([], start + 900, 900);
    clock.heartbeat(start + 5000, 5000);
    expect(dwell(clock, 5000)).toBeUndefined();
  });
  it("keeps the longest 300 paragraphs", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs(
      Array.from({ length: 400 }, (_, i) => i + 1),
      start,
      0,
    );
    clock.heartbeat(start + 2000, 2000);
    clock.paragraphs([1], start + 2000, 2000);
    clock.heartbeat(start + 4000, 4000);
    const kept = dwell(clock, 4000) ?? {};
    expect(Object.keys(kept)).toHaveLength(300);
    expect(kept[1]).toBe(4000);
  });
  it("splits dwell at local midnight with the rest of the visit", () => {
    const late = new Date(2026, 9, 12, 23, 59, 59).getTime();
    const clock = new ReadingClock(late, 0, true);
    clock.paragraphs([1], late, 0);
    for (let t = 1000; t <= 4000; t += 1000) clock.heartbeat(late + t, t);
    const days = clock.snapshots(late + 4000, 4000);
    expect(days).toHaveLength(2);
    const total = days.reduce((sum, d) => sum + (d.dwell?.[1] ?? 0), 0);
    expect(total).toBe(4000);
  });
  it("does no paragraph work for scroll and input, only on the timer", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.paragraphs([1, 2], start, 0);
    const credit = vi.spyOn(clock, "creditDwell");
    for (let i = 1; i <= 60; i++) clock.activity(start + i * 50, i * 50);
    expect(credit).not.toHaveBeenCalled();
    clock.heartbeat(start + 3000, 3000);
    expect(credit).toHaveBeenCalledTimes(1);
    expect(dwell(clock, 3000)).toEqual({ 1: 3000, 2: 3000 });
  });
});

describe("furthest paragraph", () => {
  const first = (clock: ReadingClock) =>
    clock.snapshots(start, 0)[0].paragraphIndex;
  it("follows the furthest scroll and stays put when the reader scrolls back up", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.progress(30, 12);
    clock.progress(60, 31);
    clock.progress(20, 7);
    expect(first(clock)).toBe(31);
  });
  it("clears a stale paragraph when going further without one", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.progress(30, 12);
    clock.progress(60);
    expect(first(clock)).toBeUndefined();
  });
});
