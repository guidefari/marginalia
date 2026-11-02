import {
  coverageWords,
  emptyCoverage,
  startOfLocalDay,
} from "@marginalia/backend/reading-pages";
import { describe, expect, it } from "vitest";
import { PageCoverageClock, visiblePageCells } from "./page-coverage";
import { ReadingClock } from "./reading-clock";

const config = {
  sourceId: "source",
  paragraphWords: [160, 160],
  coverage: emptyCoverage(40),
  timeZone: "UTC",
  goalWords: 3000,
};
describe("bounded visible-text page estimates", () => {
  it("credits a stationary first viewport fraction, sharing a single allowance across paragraphs", () => {
    const clock = new PageCoverageClock(config);
    clock.view(Array.from({ length: 40 }, (_, i) => i));
    clock.credit(1000, "2026-11-02");
    expect(clock.qualified("2026-11-02")).toBe(0);
    for (let i = 0; i < 9; i++) clock.credit(1000, "2026-11-02");
    expect(clock.qualified("2026-11-02")).toBe(32);
    expect(clock.qualified("2026-11-02")).toBeLessThanOrEqual(
      (10_000 * 220) / 60_000,
    );
  });
  it("finishes a single-screen short article, but a brief glance or absent geometry earns nothing", () => {
    const clock = new PageCoverageClock({
      ...config,
      paragraphWords: [3],
      coverage: "0",
    });
    clock.view(
      visiblePageCells([{ top: 100, bottom: 160, height: 60 }], [3], 800),
    );
    clock.credit(500, "2026-11-02");
    expect(clock.qualified("2026-11-02")).toBe(0);
    clock.credit(1000, "2026-11-02");
    expect(clock.qualified("2026-11-02")).toBe(3);
    clock.credit(60_000, "2026-11-02");
    expect(clock.qualified("2026-11-02")).toBe(3);
    expect(visiblePageCells([], [3], 800)).toEqual([]);
  });
  it("does not qualify unseen parts of a long paragraph or skipped paragraphs", () => {
    const cells = visiblePageCells(
      [{ top: -500, bottom: 1500, height: 2000 }],
      [160],
      800,
    );
    expect(cells).not.toContain(0);
    expect(cells).not.toContain(19);
    const clock = new PageCoverageClock(config);
    clock.view([25]);
    clock.credit(10_000, "2026-11-02");
    expect(clock.snapshot("2026-11-02")?.coverage).toBe("0000002000");
    expect(clock.qualified("2026-11-02")).toBe(8);
  });
  it("does not reset shared coverage on reopen and retains acknowledgement state monotonically", () => {
    const clock = new PageCoverageClock(config);
    clock.view([0, 1]);
    clock.credit(10_000, "2026-11-02");
    const first = clock.snapshot("2026-11-02")!;
    const reopened = new PageCoverageClock({
      ...config,
      coverage: first.coverage,
    });
    reopened.view([0, 1]);
    reopened.credit(10_000, "2026-11-03");
    expect(reopened.qualified("2026-11-03")).toBe(0);
    expect(clock.pending("2026-11-02")).toBe(16);
    clock.acknowledge("2026-11-02", first);
    clock.acknowledge("2026-11-02", { ...first, coverage: emptyCoverage(40) });
    expect(clock.pending("2026-11-02")).toBe(0);
  });
  it("keeps page coverage separate from scroll, hidden time, idle time and listening", () => {
    const start = Date.parse("2026-11-02T12:00:00Z");
    const clock = new ReadingClock(start, 0, true);
    clock.configurePages(config);
    clock.pages!.view([0, 1, 2, 3]);
    clock.progress(100);
    expect(clock.snapshots(start, 0)[0].pageCredit).toBeUndefined();
    clock.speech(true, start, 0);
    for (let tick = 1000; tick <= 10_000; tick += 1000)
      clock.heartbeat(start + tick, tick);
    expect(clock.pages!.qualified("2026-11-02")).toBe(0);
    clock.speech(false, start + 10_000, 10_000);
    clock.visibility(false, start + 10_000, 10_000);
    clock.heartbeat(start + 11_000, 11_000);
    expect(clock.pages!.qualified("2026-11-02")).toBe(0);
    clock.visibility(true, start + 11_000, 11_000);
    clock.pageVisibility(false, start + 11_000, 11_000);
    clock.heartbeat(start + 12_000, 12_000);
    expect(clock.pages!.qualified("2026-11-02")).toBe(0);
    clock.pageVisibility(true, start + 12_000, 12_000);
    for (let tick = 13_000; tick <= 22_000; tick += 1000)
      clock.heartbeat(start + tick, tick);
    expect(clock.pages!.qualified("2026-11-02")).toBe(32);
  });
  it("splits at account-zone midnight on DST dates and never includes inherited cells in the next day", () => {
    const start = Date.parse("2026-11-02T04:59:57Z"); // New York midnight after the fall-back day.
    const clock = new ReadingClock(start, 0, true, "America/New_York");
    clock.configurePages({ ...config, timeZone: "America/New_York" });
    clock.pages!.view([0, 1, 2, 3]);
    for (let tick = 1000; tick <= 6000; tick += 1000)
      clock.heartbeat(start + tick, tick);
    const pages = clock
      .snapshots(start + 6000, 6000)
      .filter((s) => s.pageCredit);
    expect(pages.map((s) => s.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(
      pages.map((s) =>
        coverageWords(s.pageCredit!.coverage, clock.pages!.weights),
      ),
    ).toEqual([8, 8]);
  });
  it("does not spend yesterday's unfinished cell allowance against today's duration cap", () => {
    const clock = new PageCoverageClock(config);
    clock.view([0]);
    clock.credit(2000, "2026-11-01");
    clock.credit(1000, "2026-11-02");
    expect(clock.qualified("2026-11-01")).toBe(0);
    expect(clock.qualified("2026-11-02")).toBe(0);
    clock.credit(2000, "2026-11-02");
    expect(clock.qualified("2026-11-02")).toBe(8);
  });
  it("stops at the idle boundary even when plenty of visible text remains, then resumes with activity", () => {
    const start = Date.parse("2026-11-02T12:00:00Z");
    const clock = new ReadingClock(start, 0, true, "UTC");
    clock.configurePages({
      ...config,
      paragraphWords: [1000],
      coverage: emptyCoverage(125),
    });
    clock.pages!.view(Array.from({ length: 125 }, (_, i) => i));
    for (let tick = 1000; tick <= 120_000; tick += 1000)
      clock.heartbeat(start + tick, tick);
    expect(clock.pages!.qualified("2026-11-02")).toBe(328);
    expect(clock.snapshots(start + 120_000, 120_000)[0].activeTimeMs).toBe(
      90_000,
    );
    clock.activity(start + 120_000, 120_000);
    for (let tick = 121_000; tick <= 130_000; tick += 1000)
      clock.heartbeat(start + tick, tick);
    expect(clock.pages!.qualified("2026-11-02")).toBe(360);
  });
  it("uses calendar midnights rather than fixed 24-hour days across both DST transitions", () => {
    const zone = "America/New_York";
    expect(
      startOfLocalDay(Date.UTC(2026, 2, 9), zone) -
        startOfLocalDay(Date.UTC(2026, 2, 8), zone),
    ).toBe(23 * 60 * 60 * 1000);
    expect(
      startOfLocalDay(Date.UTC(2026, 10, 2), zone) -
        startOfLocalDay(Date.UTC(2026, 10, 1), zone),
    ).toBe(25 * 60 * 60 * 1000);
  });
});
