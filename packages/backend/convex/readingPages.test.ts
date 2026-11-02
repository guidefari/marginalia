/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import {
  addCell,
  cellWeights,
  coverageWords,
  emptyCoverage,
  formatPages,
  pageSourceKey,
  WORDS_PER_ESTIMATED_PAGE,
} from "./lib/readingPages";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-11-02T12:00:00Z");
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = await ownerTest(modules);
  const content = Array.from({ length: 320 }, () => "word").join(" ");
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "pages",
      url: "https://example.com/pages",
      title: "Pages",
      content,
      wordCount: 320,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: NOW,
    }),
  );
  const source = await t.mutation(api.readingPages.prepareSource, {
    articleId,
    sourceKey: pageSourceKey(content),
    paragraphWords: [160, 160],
    timeZone: "UTC",
  });
  if (!("sourceId" in source) || !source.sourceId)
    throw new Error("Missing source");
  const checkpoint = {
    articleId,
    visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
    day: "2026-11-02",
    startedAt: NOW - 60_000,
    updatedAt: NOW,
    activeTimeMs: 60_000,
    visibleTimeMs: 60_000,
    timeSpentMs: 60_000,
    maxScrollPercent: 100,
    annotationsOpened: [],
    pageCredit: {
      sourceId: source.sourceId,
      coverage: addCell(emptyCoverage(40), 0),
      visualTimeMs: 60_000,
      timeZone: "UTC",
      goalWords: 3000,
    },
  };
  return { t, articleId, content, source, checkpoint };
}
describe("estimated page ledger", () => {
  it("keeps exact word numerators, including tiny sources, without per-item page rounding", () => {
    expect(WORDS_PER_ESTIMATED_PAGE).toBe(300);
    expect(cellWeights([3, 9])).toEqual([3, 8, 1]);
    expect(coverageWords("7", cellWeights([3, 9])) / 300).toBe(0.04);
    expect(formatPages(1)).toBe("<0.1");
    expect(formatPages(29)).toBe("<0.1");
    expect(formatPages(0)).toBe("0");
  });
  it("unions reversed cumulative snapshots, mixed old clients, retries and concurrent shared receipts", async () => {
    const { t, checkpoint } = await fixture();
    const latest = {
      ...checkpoint,
      pageCredit: {
        ...checkpoint.pageCredit,
        coverage: addCell(checkpoint.pageCredit.coverage, 25),
      },
    };
    expect(await t.mutation(api.readingActivity.checkpoint, latest)).toBeNull();
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const { pageCredit: _, ...legacy } = checkpoint;
    await t.mutation(api.readingActivity.checkpoint, legacy);
    await Promise.all(
      [
        latest,
        { ...latest, visitId: "270d1ba0-28c2-44b1-9d97-c9f9bc9e944e" },
      ].map((value) => t.mutation(api.readingActivity.checkpoint, value)),
    );
    const rows = await t.run((ctx) => ctx.db.query("readingPageDays").take(5));
    expect(rows).toMatchObject([{ creditedWords: 16 }]);
    const visits = await t.run((ctx) =>
      ctx.db.query("readingActivity").take(5),
    );
    expect(visits[0].pageCredit?.coverage).toBe(latest.pageCredit.coverage);
  });
  it("preserves recorded midnight dates when tomorrow arrives first, without inherited baseline credit", async () => {
    const { t, checkpoint } = await fixture();
    const yesterday = {
      ...checkpoint,
      day: "2026-11-01",
      startedAt: NOW - 86_400_000 - 60_000,
      updatedAt: NOW - 86_400_000,
    };
    const today = {
      ...checkpoint,
      pageCredit: {
        ...checkpoint.pageCredit,
        coverage: addCell(emptyCoverage(40), 25),
      },
    };
    for (const value of [today, yesterday, today, yesterday])
      await t.mutation(api.readingActivity.checkpoint, value);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("readingPageDays")
          .withIndex("by_userId_and_day", (q) => q.eq("userId", "default_user"))
          .take(5),
      ),
    ).toMatchObject([
      { day: "2026-11-01", creditedWords: 8 },
      { day: "2026-11-02", creditedWords: 8 },
    ]);
  });
  it("does not award Done, invalid coverage, excess allowance, foreign sources, or books", async () => {
    const { t, checkpoint, articleId } = await fixture();
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      pageCredit: undefined,
      finished: true,
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      pageCredit: { ...checkpoint.pageCredit, coverage: "f".repeat(11) },
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      pageCredit: { ...checkpoint.pageCredit, visualTimeMs: 1 },
    });
    await t.run((ctx) => ctx.db.patch(articleId, { bookUnitCount: 2 }));
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    expect(
      await t.run((ctx) => ctx.db.query("readingPageDays").take(5)),
    ).toEqual([]);
  });
  it("freezes source snapshots, keeps already queued coverage valid, and does not rewrite history", async () => {
    const { t, checkpoint, articleId, content } = await fixture();
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    await t.run((ctx) =>
      ctx.db.patch(articleId, {
        content: `${content} changed`,
        wordCount: 321,
      }),
    );
    const updated = await t.mutation(api.readingPages.prepareSource, {
      articleId,
      sourceKey: pageSourceKey(`${content} changed`),
      paragraphWords: [161, 160],
      timeZone: "UTC",
    });
    expect(updated).toHaveProperty("unavailable");
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      pageCredit: {
        ...checkpoint.pageCredit,
        coverage: addCell(checkpoint.pageCredit.coverage, 25),
      },
    });
    expect(
      (await t.run((ctx) => ctx.db.query("readingPageDays").take(5)))[0]
        .creditedWords,
    ).toBe(16);
  });
  it("validates goals, freezes today's target, edits tomorrow, disables/re-enables without resetting achievement", async () => {
    const { t, checkpoint } = await fixture();
    for (const pages of [0, -1, 1.5, 1001])
      await expect(
        t.mutation(api.readingPages.setGoal, { pages, timeZone: "UTC" }),
      ).rejects.toThrow();
    await t.mutation(api.readingPages.setGoal, { pages: 1, timeZone: "UTC" });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      activeTimeMs: 90_000,
      visibleTimeMs: 90_000,
      timeSpentMs: 90_000,
      startedAt: NOW - 90_000,
      pageCredit: {
        ...checkpoint.pageCredit,
        coverage: "f".repeat(10),
        visualTimeMs: 90_000,
      },
    });
    expect(
      await t.mutation(api.readingPages.claimCelebration, {
        day: checkpoint.day,
      }),
    ).toBe(true);
    expect(
      await t.mutation(api.readingPages.claimCelebration, {
        day: checkpoint.day,
      }),
    ).toBe(false);
    await t.mutation(api.readingPages.setGoal, { pages: 10, timeZone: "UTC" });
    await t.mutation(api.readingPages.setGoal, {
      pages: null,
      timeZone: "UTC",
    });
    await t.mutation(api.readingPages.setGoal, { pages: 5, timeZone: "UTC" });
    const overview = await t.query(api.readingPages.overview, {
      today: checkpoint.day,
      timeZone: "UTC",
      days: 90,
    });
    expect(overview.history[0]).toMatchObject({
      creditedWords: 320,
      goalWords: 300,
      presentedAt: NOW,
    });
    expect(overview).toMatchObject({
      visible: true,
      pendingGoalWords: 1500,
      pendingGoalDay: "2026-11-03",
    });
    expect(
      await t.mutation(api.readingPages.claimCelebration, {
        day: checkpoint.day,
      }),
    ).toBe(false);
  });
  it("isolates readers, including source initialization and exact reporting", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.owner.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "private",
        url: "https://example.com",
        title: "Private",
        content: "private",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    await expect(
      f.reader.mutation(api.readingPages.prepareSource, {
        articleId,
        sourceKey: pageSourceKey("private"),
        paragraphWords: [1],
        timeZone: "UTC",
      }),
    ).rejects.toThrow("Article not found");
    expect(
      (
        await f.reader.query(api.readingPages.overview, {
          timeZone: "UTC",
          today: "2026-11-02",
        })
      ).history,
    ).toEqual([]);
  });
  it("keeps the daily query exact when the old reporting projection has no visit data", async () => {
    const { t } = await fixture();
    await t.run((ctx) =>
      ctx.db.insert("readingPageDays", {
        userId: "default_user",
        day: "2026-11-02",
        timeZone: "UTC",
        creditedWords: 12_345,
        goalWords: 3000,
      }),
    );
    const result = await t.query(api.readingPages.overview, {
      timeZone: "UTC",
      today: "2026-11-02",
      days: 999,
    });
    expect(result.history).toMatchObject([
      { creditedWords: 12_345, goalWords: 3000 },
    ]);
    expect(
      await t.run((ctx) => ctx.db.query("visitReportingMetadata").take(1)),
    ).toEqual([]);
  });
  it("keeps worst-case page coverage plus legacy dwell below the beacon request limit", () => {
    const dwell = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [String(i + 1), 93_600_000]),
    );
    const payload = {
      articleId: "a".repeat(100),
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: "2026-11-02",
      startedAt: NOW - 90_000,
      updatedAt: NOW,
      activeTimeMs: 90_000,
      visibleTimeMs: 90_000,
      timeSpentMs: 90_000,
      maxScrollPercent: 100,
      annotationsOpened: Array.from({ length: 128 }, () => "a".repeat(100)),
      dwell,
      pageCredit: {
        sourceId: "a".repeat(100),
        coverage: "f".repeat(4250),
        visualTimeMs: 90_000,
        timeZone: "America/Argentina/Buenos_Aires",
        goalWords: 300_000,
      },
    };
    expect(
      new TextEncoder().encode(JSON.stringify(payload)).length,
    ).toBeLessThan(32_000);
  });
});
