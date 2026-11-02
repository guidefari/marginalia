/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { ReadingClock } from "../../../apps/web/src/lib/reading-clock";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { countFeedOutcome } from "./feedStats";
import { metadataTriggers } from "./lib/metadataTriggers";
import { pageSourceKey } from "./lib/readingPages";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

async function feedWithArticle(
  ctx: MutationCtx,
  userId: string,
  name: string,
  withFeed = true,
) {
  const feedId = withFeed
    ? await ctx.db.insert("feeds", {
        userId,
        url: `https://${name}.example/feed`,
        title: name,
        isActive: true,
        createdAt: Date.now(),
      })
    : undefined;
  const articleId = await ctx.db.insert("articles", {
    feedId,
    userId,
    guid: `${userId}-${name}`,
    url: `https://${name}.example/a`,
    title: name,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
  });
  return { feedId, articleId };
}
const stats = (t: Fixture["t"]) =>
  t.run((ctx) => ctx.db.query("feedStats").collect());
const totals = (rows: Awaited<ReturnType<typeof stats>>) =>
  rows.map(({ userId, feedId, offered, opened, finished, skipped }) => ({
    userId,
    feedId,
    offered,
    opened,
    finished,
    skipped,
  }));

const finish = async (t: Fixture["t"]) => {
  // Rebuilds run in pages of a few rows, so the chain is long
  await (
    t as unknown as {
      finishAllScheduledFunctions: (
        advance: () => void,
        maxIterations: number,
      ) => Promise<void>;
    }
  ).finishAllScheduledFunctions(vi.runAllTimers, 2000);
};

describe("per-feed outcome counts", () => {
  it("records one human visit/open when coverage attaches after a startup checkpoint across account midnight", async () => {
    const start = Date.parse("2026-11-02T04:59:58Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      const { t, owner } = await secondReaderTest(modules);
      const { feedId, articleId } = await t.run((ctx) =>
        feedWithArticle(ctx, OWNER, "late-pages"),
      );
      const content = Array.from({ length: 320 }, () => "word").join(" ");
      await t.run((ctx) =>
        ctx.db.patch(articleId, { content, wordCount: 320 }),
      );
      await owner.mutation(api.readingPages.initializeDay, {
        timeZone: "America/New_York",
      });
      const bootstrap = await owner.query(api.readerBootstrap.get, {
        articleId,
      });
      expect(bootstrap?.readingTimeZone).toBe("America/New_York");
      const clock = new ReadingClock(
        start,
        0,
        true,
        bootstrap?.readingTimeZone,
      );
      clock.paragraphs([1], start, 0);
      const visitId = "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e";
      const startup = clock.snapshots(start, 0)[0];
      const input = (sample: typeof startup) => ({
        ...sample,
        articleId,
        visitId,
      });
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, input(startup));
      now.mockReturnValue(start + 1000);
      clock.heartbeat(start + 1000, 1000);
      const source = await owner.mutation(api.readingPages.prepareSource, {
        articleId,
        sourceKey: pageSourceKey(content),
        paragraphWords: [160, 160],
        timeZone: "UTC",
      });
      if (!("sourceId" in source) || !source.sourceId)
        throw new Error("Missing coverage source");
      expect(clock.configurePages(source)).toBe(true);
      clock.pages?.view([0]);
      for (let tick = 2000; tick <= 5000; tick += 1000)
        clock.heartbeat(start + tick, tick);
      now.mockReturnValue(start + 5000);
      clock.acknowledge(startup); // Late startup acknowledgement must not drop the newer closed-day state.
      const late = clock.snapshots(start + 5000, 5000);
      expect(late.map((sample) => sample.day)).toEqual([
        "2026-11-01",
        "2026-11-02",
      ]);
      for (const sample of [late[1], startup, late[0], late[1], late[0]])
        await owner.mutation(api.readingActivity.checkpoint, input(sample));
      const visits = await t.run((ctx) =>
        ctx.db
          .query("readingActivity")
          .withIndex("by_user_article", (q) =>
            q.eq("userId", OWNER).eq("articleId", articleId),
          )
          .take(5),
      );
      expect(visits).toHaveLength(2); // Two dates, one actual visit.
      expect(new Set(visits.map((row) => row.visitId)).size).toBe(1);
      expect(visits.reduce((total, row) => total + row.activeTimeMs, 0)).toBe(
        5000,
      );
      const opened = await t.run((ctx) =>
        ctx.db
          .query("articleInteractions")
          .withIndex("by_user_article_action", (q) =>
            q
              .eq("userId", OWNER)
              .eq("articleId", articleId)
              .eq("action", "opened"),
          )
          .take(5),
      );
      expect(opened.filter((row) => row.visitId === visitId)).toHaveLength(1);
      expect((await stats(t))[0]).toMatchObject({ feedId, opened: 1 });
      expect(
        await t.run((ctx) => ctx.db.query("feedOpenCounts").first()),
      ).toMatchObject({ desk: 1, visit: 1 });
      const days = await t.run((ctx) =>
        ctx.db
          .query("readingPageDays")
          .withIndex("by_userId_and_day", (q) => q.eq("userId", OWNER))
          .take(5),
      );
      expect(days.find((row) => row.day === "2026-11-02")?.creditedWords).toBe(
        8,
      );
    } finally {
      now.mockRestore();
    }
  });
  it("counts offered, opened, finished and skipped as they happen, and nothing else", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const { feedId, articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, OWNER, "one"),
    );
    for (const action of [
      "presented",
      "presented",
      "skipped",
      "saved",
      "abandoned",
      "opened",
      "finished",
    ] as const)
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        action,
      });
    expect(totals(await stats(t))).toEqual([
      {
        userId: OWNER,
        feedId,
        offered: 2,
        opened: 1,
        finished: 1,
        skipped: 1,
      },
    ]);
  });

  it("counts the opened and finished interactions that reading checkpoints write", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const { feedId, articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, OWNER, "reading"),
    );
    const startedAt = Date.now() - 20_000;
    const checkpoint = {
      articleId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: startedAt + 10_000,
      activeTimeMs: 6000,
      visibleTimeMs: 8000,
      timeSpentMs: 10_000,
      maxScrollPercent: 40,
      annotationsOpened: [],
    };
    await owner.mutation(api.readingActivity.checkpoint, checkpoint);
    // A retry of the same cumulative checkpoint adds nothing
    await owner.mutation(api.readingActivity.checkpoint, checkpoint);
    await owner.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    await owner.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    const [row] = await stats(t);
    expect(row).toMatchObject({ feedId, opened: 1, finished: 1, offered: 0 });
  });

  describe("one open or finish is one outcome", () => {
    async function setup() {
      const f = await secondReaderTest(modules);
      const { feedId, articleId } = await f.t.run((ctx) =>
        feedWithArticle(ctx, OWNER, "paired"),
      );
      const sessionId = await f.owner.mutation(api.sessions.create, {
        requestedMinutes: 10,
      });
      const startedAt = Date.now() - 20_000;
      const checkpoint = (visitId: string, extra = {}) => ({
        articleId,
        sessionId,
        visitId,
        day: new Date(startedAt).toISOString().slice(0, 10),
        startedAt,
        updatedAt: startedAt + 10_000,
        activeTimeMs: 6000,
        visibleTimeMs: 8000,
        timeSpentMs: 10_000,
        maxScrollPercent: 40,
        annotationsOpened: [],
        ...extra,
      });
      return { ...f, feedId, articleId, sessionId, checkpoint };
    }
    const VISIT = "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e";
    const VISIT_2 = "270d1ba0-28c2-44b1-9d97-c9f9bc9e944e";

    it("counts the desk's open and the reader page's first checkpoint as one", async () => {
      const { t, owner, articleId, sessionId, checkpoint } = await setup();
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      expect((await stats(t))[0].opened).toBe(1);
    });

    it("counts the same pair once when the checkpoint beats the desk's record", async () => {
      const { t, owner, articleId, sessionId, checkpoint } = await setup();
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      expect((await stats(t))[0].opened).toBe(1);
    });

    it("still counts a later visit, with or without the desk", async () => {
      const { t, owner, articleId, sessionId, checkpoint } = await setup();
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT_2));
      expect((await stats(t))[0].opened).toBe(2);
      const VISIT_3 = "370d1ba0-28c2-44b1-9d97-c9f9bc9e944e";
      await owner.mutation(api.readingActivity.checkpoint, {
        ...checkpoint(VISIT_3),
        sessionId: undefined,
      });
      expect((await stats(t))[0].opened).toBe(3);
    });

    it("pairs the same way when the backfill counts the history later", async () => {
      vi.useFakeTimers();
      const { t, articleId, sessionId } = await setup();
      await t.run(async (ctx) => {
        for (const visitId of [undefined, VISIT, undefined, VISIT_2])
          await ctx.db.insert("articleInteractions", {
            userId: OWNER,
            articleId,
            sessionId,
            visitId,
            action: "opened",
            createdAt: Date.now(),
          });
      });
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
      await finish(t);
      expect((await stats(t))[0].opened).toBe(2);
      vi.useRealTimers();
    });

    it("counts a visit's finish once when it is retried on the next day", async () => {
      const { t, owner, articleId, checkpoint } = await setup();
      const began = Date.now() - 3 * 24 * 3_600_000;
      const first = checkpoint(VISIT, {
        finished: true,
        startedAt: began,
        updatedAt: began + 10_000,
        day: new Date(began).toISOString().slice(0, 10),
      });
      await owner.mutation(api.readingActivity.checkpoint, first);
      // The same visit's finish, retried once the clock has passed midnight
      const dayTwo = new Date(first.startedAt + 24 * 3_600_000);
      await owner.mutation(api.readingActivity.checkpoint, {
        ...first,
        day: dayTwo.toISOString().slice(0, 10),
        startedAt: dayTwo.getTime(),
        updatedAt: dayTwo.getTime() + 1000,
        activeTimeMs: 500,
        visibleTimeMs: 800,
        timeSpentMs: 1000,
      });
      const finished = await t.run((ctx) =>
        ctx.db
          .query("articleInteractions")
          .withIndex("by_user_article_action", (q) =>
            q
              .eq("userId", OWNER)
              .eq("articleId", articleId)
              .eq("action", "finished"),
          )
          .collect(),
      );
      expect(finished).toHaveLength(1);
      expect((await stats(t))[0].finished).toBe(1);
    });
  });

  it("leaves articles without a feed uncounted", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const { articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, OWNER, "loose", false),
    );
    await owner.mutation(api.sessions.recordInteraction, {
      articleId,
      action: "presented",
    });
    expect(await stats(t)).toHaveLength(0);
  });

  it("keeps each reader's counts apart", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    const mine = await t.run((ctx) => feedWithArticle(ctx, OWNER, "mine"));
    const theirs = await t.run((ctx) =>
      feedWithArticle(ctx, readerLibraryId, "theirs"),
    );
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: mine.articleId,
      action: "presented",
    });
    await reader.mutation(api.sessions.recordInteraction, {
      articleId: theirs.articleId,
      action: "skipped",
    });
    await expect(
      reader.mutation(api.sessions.recordInteraction, {
        articleId: mine.articleId,
        action: "presented",
      }),
    ).rejects.toThrow("Article not found");
    const rows = totals(await stats(t));
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        userId: OWNER,
        feedId: mine.feedId,
        offered: 1,
        skipped: 0,
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        userId: readerLibraryId,
        feedId: theirs.feedId,
        offered: 0,
        skipped: 1,
      }),
    );
  });

  it("matches a recount of articleInteractions after a mix of interactions", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    const b = await t.run((ctx) => feedWithArticle(ctx, OWNER, "b"));
    const plan = [
      [a, "presented"],
      [b, "presented"],
      [a, "opened"],
      [b, "skipped"],
      [a, "finished"],
      [a, "presented"],
      [b, "saved"],
    ] as const;
    for (const [{ articleId }, action] of plan)
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        action,
      });
    const counted = new Map<string, number>();
    for (const [{ feedId }, action] of plan) {
      const key = `${feedId}:${action}`;
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
    for (const row of await stats(t)) {
      expect(row.offered).toBe(counted.get(`${row.feedId}:presented`) ?? 0);
      expect(row.opened).toBe(counted.get(`${row.feedId}:opened`) ?? 0);
      expect(row.finished).toBe(counted.get(`${row.feedId}:finished`) ?? 0);
      expect(row.skipped).toBe(counted.get(`${row.feedId}:skipped`) ?? 0);
    }
  });
});

describe("feed stats backfill", () => {
  /** History written before the counters existed: interactions with no counts. */
  async function seedHistory(
    t: Fixture["t"],
    userId: string,
    articleId: Id<"articles">,
    actions: ("presented" | "opened" | "finished" | "skipped" | "saved")[],
  ) {
    await t.run(async (ctx) => {
      for (const action of actions)
        await ctx.db.insert("articleInteractions", {
          userId,
          articleId,
          action,
          createdAt: Date.now(),
        });
    });
  }
  it("counts existing history in resumable pages, once, whatever order it was stored", async () => {
    vi.useFakeTimers();
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    const b = await t.run((ctx) => feedWithArticle(ctx, OWNER, "b"));
    const other = await t.run((ctx) =>
      feedWithArticle(ctx, readerLibraryId, "other"),
    );
    // 30 interactions is several pages
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 12 }, () => "presented" as const),
    );
    await seedHistory(t, OWNER, b.articleId, ["skipped", "opened", "saved"]);
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 6 }, () => "finished" as const),
    );
    await seedHistory(t, readerLibraryId, other.articleId, ["presented"]);
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    // One page only so far: resumable, not complete
    const partial = await t.run((ctx) =>
      ctx.db.query("feedStatsBackfill").collect(),
    );
    expect(partial[0].ready).toBe(false);
    await finish(t);
    await finish(t);
    const state = await t.run((ctx) =>
      ctx.db.query("feedStatsBackfill").collect(),
    );
    expect(state.map((s) => s.ready)).toEqual([true]);
    const rows = totals(await stats(t));
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      userId: OWNER,
      feedId: a.feedId,
      offered: 12,
      opened: 0,
      finished: 6,
      skipped: 0,
    });
    expect(rows).toContainEqual({
      userId: OWNER,
      feedId: b.feedId,
      offered: 0,
      opened: 1,
      finished: 0,
      skipped: 1,
    });
    // Running it again, or concurrently, changes nothing
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await Promise.all([
      t.mutation(internal.feedStats.backfill, { userId: OWNER }),
      t.mutation(internal.feedStats.backfill, { userId: OWNER }),
    ]);
    await finish(t);
    expect(totals(await stats(t))).toEqual(rows);
    vi.useRealTimers();
  });

  it("decides each interaction once, however live counting and the backfill interleave", async () => {
    vi.useFakeTimers();
    const { t, owner } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 20 }, () => "presented" as const),
    );
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: a.articleId,
      action: "presented",
    });
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: a.articleId,
      action: "presented",
    });
    await finish(t);
    expect((await stats(t))[0].offered).toBe(22);
    // Starting over from the first interaction finds every one already decided
    await t.run(async (ctx) => {
      const state = await ctx.db.query("feedStatsBackfill").first();
      if (state)
        await ctx.db.replace(state._id, { userId: OWNER, ready: false });
    });
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect((await stats(t))[0].offered).toBe(22);
    vi.useRealTimers();
  });

  it("counts a late-committed interaction created before its neighbours exactly once", async () => {
    vi.useFakeTimers();
    const { t } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    await seedHistory(t, OWNER, a.articleId, ["presented"]);
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    // A row an older deployment wrote after the backfill had passed is decided
    // by its marker alone: a second run counts it once, a third adds nothing
    await seedHistory(t, OWNER, a.articleId, ["presented"]);
    await t.run(async (ctx) => {
      const state = await ctx.db.query("feedStatsBackfill").first();
      if (state)
        await ctx.db.replace(state._id, { userId: OWNER, ready: false });
    });
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
      await finish(t);
      await t.run(async (ctx) => {
        const state = await ctx.db.query("feedStatsBackfill").first();
        if (state)
          await ctx.db.replace(state._id, { userId: OWNER, ready: false });
      });
    }
    expect((await stats(t))[0].offered).toBe(2);
    vi.useRealTimers();
  });

  it("skips history for deleted articles and readers who are no longer active", async () => {
    vi.useFakeTimers();
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const gone = await t.run((ctx) => feedWithArticle(ctx, OWNER, "gone"));
    await seedHistory(t, OWNER, gone.articleId, ["presented"]);
    await t.run((ctx) => ctx.db.delete(gone.articleId));
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect(await stats(t)).toHaveLength(0);
    await t.run(async (ctx) => {
      const reader = await ctx.db.query("readers").first();
      if (reader) await ctx.db.patch(reader._id, { status: "disabled" });
    });
    await t.mutation(internal.feedStats.backfill, { userId: readerLibraryId });
    expect(
      await t.run((ctx) => ctx.db.query("feedStatsBackfill").collect()),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  it("is started for every active reader by the background fan-out", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.mutation(internal.background.fanOut, { job: "feedStats" });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(50),
    );
    const users = jobs
      .filter((job) => job.name.includes("feedStats"))
      .map((job) => (job.args[0] as { userId: string }).userId);
    expect(new Set(users)).toEqual(new Set([OWNER, readerLibraryId]));
  });
});

describe("a library being deleted", () => {
  it("takes no late checkpoint, offer or backfill once deletion has started", async () => {
    vi.useFakeTimers();
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const { articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, readerLibraryId, "late"),
    );
    await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    const startedAt = Date.now() - 20_000;
    const late = {
      articleId,
      userId: readerLibraryId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: startedAt + 10_000,
      activeTimeMs: 6000,
      visibleTimeMs: 8000,
      timeSpentMs: 10_000,
      maxScrollPercent: 40,
      annotationsOpened: [],
      dwell: { "1": 3000 },
    };
    await expect(
      t.mutation(internal.readingActivity.record, late),
    ).rejects.toThrow("no longer active");
    await t.run(async (ctx) => {
      const interaction = await ctx.db.insert("articleInteractions", {
        userId: readerLibraryId,
        articleId,
        action: "presented",
        createdAt: Date.now(),
      });
      const article = await ctx.db.get(articleId);
      if (article) await countFeedOutcome(ctx, article, interaction);
    });
    await t.mutation(internal.feedStats.backfill, { userId: readerLibraryId });
    const rows = await t.run(async (ctx) => ({
      dwell: await ctx.db.query("paragraphDwell").collect(),
      activity: await ctx.db.query("readingActivity").collect(),
      stats: await ctx.db.query("feedStats").collect(),
      state: await ctx.db.query("feedStatsBackfill").collect(),
    }));
    expect(rows).toEqual({ dwell: [], activity: [], stats: [], state: [] });
    vi.useRealTimers();
  });
});

describe("opens and finishes past any scan window", () => {
  const VISIT = (n: number) => `visit-${n}`;

  async function setup() {
    const f = await secondReaderTest(modules);
    const article = await f.t.run((ctx) => feedWithArticle(ctx, OWNER, "busy"));
    const sessionId = await f.owner.mutation(api.sessions.create, {
      requestedMinutes: 10,
    });
    const sessionB = await f.owner.mutation(api.sessions.create, {
      requestedMinutes: 10,
    });
    /** Inserts and counts in its own transaction, as the live path does. */
    const live = (
      action: "opened" | "finished",
      extra: { sessionId?: Id<"sessions">; visitId?: string },
    ) =>
      f.t.run(async (ctx) => {
        const id = await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId: article.articleId,
          action,
          createdAt: Date.now(),
          ...extra,
        });
        const row = await ctx.db.get(article.articleId);
        if (row) await countFeedOutcome(ctx, row, id);
      });
    const seed = (
      rows: {
        action?: "opened" | "finished";
        sessionId?: Id<"sessions">;
        visitId?: string;
        feedCounted?: boolean;
      }[],
    ) =>
      f.t.run(async (ctx) => {
        for (const row of rows)
          await ctx.db.insert("articleInteractions", {
            userId: OWNER,
            articleId: article.articleId,
            action: row.action ?? "opened",
            sessionId: row.sessionId,
            visitId: row.visitId,
            feedCounted: row.feedCounted,
            createdAt: Date.now(),
          });
      });
    const opened = async () => (await stats(f.t))[0]?.opened;
    return { ...f, ...article, sessionId, sessionB, live, seed, opened };
  }

  it("counts 101 alternating desk and visit pairs in one session as 101", async () => {
    const { live, opened, sessionId } = await setup();
    for (let i = 0; i < 101; i++) {
      await live("opened", { sessionId });
      await live("opened", { sessionId, visitId: VISIT(i) });
    }
    expect(await opened()).toBe(101);
  });

  it("counts 101 pairs with no session as 101, and visit-first pairs the same", async () => {
    const { live, opened } = await setup();
    for (let i = 0; i < 101; i++) {
      if (i % 2) {
        await live("opened", { visitId: VISIT(i) });
        await live("opened", {});
      } else {
        await live("opened", {});
        await live("opened", { visitId: VISIT(i) });
      }
    }
    expect(await opened()).toBe(101);
  });

  it("counts a new desk open in a session whose earlier pair is over 200 rows back", async () => {
    const { live, opened, sessionId, sessionB } = await setup();
    await live("opened", { sessionId });
    await live("opened", { sessionId, visitId: VISIT(0) });
    for (let i = 0; i < 200; i++) await live("opened", { sessionId: sessionB });
    expect(await opened()).toBe(201);
    await live("opened", { sessionId });
    expect(await opened()).toBe(202);
  });

  it("counts a backfill over 202 rows, a pair before 200 desk-only opens elsewhere, as 201", async () => {
    vi.useFakeTimers();
    const { t, seed, opened, sessionId, sessionB } = await setup();
    await seed([
      { sessionId },
      { sessionId, visitId: VISIT(0) },
      ...Array.from({ length: 200 }, () => ({ sessionId: sessionB })),
    ]);
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect(await opened()).toBe(201);
    const counters = await t.run((ctx) =>
      ctx.db.query("feedOpenCounts").collect(),
    );
    expect(
      counters.map(({ sessionId: s, desk, visit }) => [s, desk, visit]),
    ).toEqual(
      expect.arrayContaining([
        [sessionId, 1, 1],
        [sessionB, 200, 0],
      ]),
    );
    vi.useRealTimers();
  });

  it("counts a visit's finish once however many finished rows it has", async () => {
    const { live, t, feedId, seed } = await setup();
    for (let i = 0; i < 250; i++) await live("finished", { visitId: VISIT(1) });
    await live("finished", { visitId: VISIT(2) });
    expect((await stats(t))[0]).toMatchObject({ feedId, finished: 2 });
    // The backfill agrees on the same rows stored as history
    vi.useFakeTimers();
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("articleInteractions").collect())
        await ctx.db.delete(row._id);
      for (const row of await ctx.db.query("feedStats").collect())
        await ctx.db.delete(row._id);
      for (const row of await ctx.db.query("feedStatsBackfill").collect())
        await ctx.db.delete(row._id);
    });
    await seed(
      Array.from({ length: 250 }, () => ({
        action: "finished" as const,
        visitId: VISIT(1),
      })),
    );
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect((await stats(t))[0]).toMatchObject({ finished: 1 });
    vi.useRealTimers();
  });

  it("counts opens that arrive while a rebuild is half done exactly once", async () => {
    vi.useFakeTimers();
    const { t, seed, live, opened, sessionId } = await setup();
    await seed(Array.from({ length: 20 }, () => ({ sessionId })));
    vi.advanceTimersByTime(10);
    const state = () =>
      t.run((ctx) => ctx.db.query("feedStatsBackfill").unique());
    // Step the rebuild by hand until the counting pass is under way
    for (let i = 0; i < 100 && (await state())?.phase !== "count"; i++)
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    expect((await state())?.seen).toBeDefined();
    // Ahead of the cursor: left for the rebuild, which pairs it with a desk open
    await live("opened", { sessionId, visitId: VISIT(1) });
    expect((await state())?.dirty).toBeUndefined();
    // Behind the cursor (the cursor is moved past it, as a row that committed
    // late with an early creation time would be): the rebuild must pass again
    await t.run(async (ctx) => {
      const row = await ctx.db.query("feedStatsBackfill").unique();
      if (row) await ctx.db.patch(row._id, { seen: Date.now() + 1e9 });
    });
    await live("opened", { sessionId });
    expect((await state())?.dirty).toBe(true);
    let steps = 0;
    while (!(await state())?.ready && steps++ < 200)
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    expect((await state())?.ready).toBe(true);
    expect((await state())?.dirty).toBeUndefined();
    // 21 desk opens and one visit: 21
    expect(await opened()).toBe(21);
    // Once ready the live path counts at once
    await live("opened", { sessionId });
    expect(await opened()).toBe(22);
    const rows = await t.run((ctx) =>
      ctx.db.query("articleInteractions").collect(),
    );
    expect(rows.every((row) => row.feedCounted === true)).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.query("feedOpenCounts").unique()),
    ).toMatchObject({ desk: 22, visit: 1 });
    await finish(t);
    expect(await opened()).toBe(22);
    vi.useRealTimers();
  });

  describe("a reader whose counts predate the rebuild", () => {
    const legacy = (t: Fixture["t"], ready: boolean) =>
      t.run((ctx) =>
        ctx.db.insert("feedStatsBackfill", { userId: OWNER, ready }),
      );
    const setStats = (
      t: Fixture["t"],
      feedId: Id<"feeds">,
      counts: { opened?: number; finished?: number },
    ) =>
      t.run((ctx) =>
        ctx.db.insert("feedStats", {
          userId: OWNER,
          feedId,
          offered: 0,
          opened: counts.opened ?? 0,
          finished: counts.finished ?? 0,
          skipped: 0,
          updatedAt: Date.now(),
        }),
      );

    it("does not add an unmarked earlier desk open on top of a credited visit", async () => {
      vi.useFakeTimers();
      const { t, feedId, seed, live, opened, sessionId } = await setup();
      // The desk row committed after its visit had already been credited
      await seed([
        { sessionId },
        { sessionId, visitId: VISIT(1), feedCounted: true },
      ]);
      await setStats(t, feedId as Id<"feeds">, { opened: 1 });
      await legacy(t, true);
      await live("opened", { sessionId, visitId: VISIT(2) });
      await finish(t);
      // One desk open and two visits are two opens
      expect(await opened()).toBe(2);
      vi.useRealTimers();
    });

    it("credits a visit's finish even when a later duplicate was marked first", async () => {
      vi.useFakeTimers();
      const { t, feedId, seed } = await setup();
      await seed([
        { action: "finished", visitId: VISIT(1) },
        { action: "finished", visitId: VISIT(1), feedCounted: true },
      ]);
      await setStats(t, feedId as Id<"feeds">, { finished: 0 });
      await legacy(t, false);
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
      await finish(t);
      expect((await stats(t))[0].finished).toBe(1);
      vi.useRealTimers();
    });

    it("rebuilds a reader with large annotationsOpened payloads within the read limit", async () => {
      vi.useFakeTimers();
      // The platform's 16 MiB read limit, which 400 rows of the largest valid
      // annotationsOpened (128 strings of 100 bytes) exceed in one transaction
      const { t } = await secondReaderTest(modules, {
        transactionLimits: true,
      });
      const annotationsOpened = Array.from({ length: 128 }, (_, i) =>
        `${i}`.padEnd(100, "x"),
      );
      const { feedId, articleId } = await t.run(async (ctx) => {
        const made = await feedWithArticle(ctx, OWNER, "heavy");
        for (let i = 0; i < 400; i += 100)
          for (let j = i; j < i + 100; j++)
            await ctx.db.insert("articleInteractions", {
              userId: OWNER,
              articleId: made.articleId,
              action: "opened",
              annotationsOpened,
              createdAt: j,
            });
        await ctx.db.insert("feedStatsBackfill", {
          userId: OWNER,
          ready: true,
        });
        return made;
      });
      // A live open, with the table triggers the real mutations run
      await t.run(async (raw) => {
        const ctx = metadataTriggers.wrapDB(raw);
        const article = await ctx.db.get(articleId);
        const id = await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId,
          action: "opened",
          createdAt: 401,
        });
        if (article) await countFeedOutcome(ctx, article, id);
      });
      await finish(t);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStatsBackfill").unique()))
          ?.ready,
      ).toBe(true);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStats").unique()))?.opened,
      ).toBe(401);
      expect(feedId).toBeDefined();
      vi.useRealTimers();
    });
  });

  describe("a rebuild that must not stall", () => {
    const pending = (t: Fixture["t"]) =>
      t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").take(500)).filter(
          (job) =>
            job.name.includes("feedStats") && job.state.kind === "pending",
        ),
      );
    async function readerWithHistory(opens: number) {
      const f = await secondReaderTest(modules);
      const made = await f.t.run(async (ctx) => {
        const m = await feedWithArticle(ctx, f.readerLibraryId, "theirs");
        for (let i = 0; i < opens; i++)
          await ctx.db.insert("articleInteractions", {
            userId: f.readerLibraryId,
            articleId: m.articleId,
            action: "opened",
            createdAt: i,
          });
        return m;
      });
      const live = () =>
        f.t.run(async (ctx) => {
          const id = await ctx.db.insert("articleInteractions", {
            userId: f.readerLibraryId,
            articleId: made.articleId,
            action: "opened",
            createdAt: Date.now(),
          });
          const article = await ctx.db.get(made.articleId);
          if (article) await countFeedOutcome(ctx, article, id);
        });
      return { ...f, ...made, live };
    }

    it("finishes after the reader is disabled between pages and enabled again", async () => {
      vi.useFakeTimers();
      const { t, owner, readerLibraryId, live } = await readerWithHistory(12);
      const row = await t.run((ctx) =>
        ctx.db
          .query("readers")
          .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
          .unique(),
      );
      const readerId = row?._id as Id<"readers">;
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
      });
      await owner.mutation(api.readers.setStatus, {
        readerId,
        status: "disabled",
      });
      // The queued step runs while disabled and goes no further
      await finish(t);
      expect(await pending(t)).toHaveLength(0);
      await owner.mutation(api.readers.setStatus, {
        readerId,
        status: "active",
      });
      for (let i = 0; i < 3; i++) await live();
      await finish(t);
      const state = await t.run((ctx) =>
        ctx.db.query("feedStatsBackfill").unique(),
      );
      expect(state?.ready).toBe(true);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStats").unique()))?.opened,
      ).toBe(15);
      vi.useRealTimers();
    });

    it("reschedules from a live write once a scheduled step looks lost", async () => {
      vi.useFakeTimers();
      const { t, readerLibraryId, live } = await readerWithHistory(12);
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
      });
      // The step is lost without anything re-enabling the reader
      await t.run(async (ctx) => {
        for (const job of await ctx.db.system
          .query("_scheduled_functions")
          .take(50))
          if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      });
      await live();
      expect(await pending(t)).toHaveLength(0);
      vi.advanceTimersByTime(61_000);
      await live();
      expect(await pending(t)).toHaveLength(1);
      await finish(t);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStatsBackfill").unique()))
          ?.ready,
      ).toBe(true);
      vi.useRealTimers();
    });

    const setStatus = async (
      f: Awaited<ReturnType<typeof readerWithHistory>>,
      status: "active" | "disabled",
    ) => {
      const row = await f.t.run((ctx) =>
        ctx.db
          .query("readers")
          .withIndex("by_libraryId", (q) =>
            q.eq("libraryId", f.readerLibraryId),
          )
          .unique(),
      );
      await f.owner.mutation(api.readers.setStatus, {
        readerId: row?._id as Id<"readers">,
        status,
      });
    };
    const rebuildState = (t: Fixture["t"]) =>
      t.run((ctx) => ctx.db.query("feedStatsBackfill").unique());

    it("keeps one chain through repeated disable and enable while a step is pending", async () => {
      vi.useFakeTimers();
      const f = await readerWithHistory(12);
      const { t, readerLibraryId } = f;
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
      });
      expect(await pending(t)).toHaveLength(1);
      for (let i = 0; i < 4; i++) {
        await setStatus(f, "disabled");
        await setStatus(f, "active");
        expect(await pending(t)).toHaveLength(1);
      }
      await finish(t);
      expect(await pending(t)).toHaveLength(0);
      expect((await rebuildState(t))?.ready).toBe(true);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStats").unique()))?.opened,
      ).toBe(12);
      vi.useRealTimers();
    });

    it("keeps one chain when a slow step is rescheduled by live writes", async () => {
      vi.useFakeTimers();
      const { t, readerLibraryId, live } = await readerWithHistory(12);
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
      });
      for (let i = 0; i < 3; i++) {
        // The step is alive but slow: more than a minute has passed
        vi.advanceTimersByTime(61_000);
        await live();
        await live();
        expect(await pending(t)).toHaveLength(1);
      }
      await finish(t);
      expect(await pending(t)).toHaveLength(0);
      expect((await rebuildState(t))?.ready).toBe(true);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStats").unique()))?.opened,
      ).toBe(18);
      vi.useRealTimers();
    });

    it("does nothing when a superseded step arrives", async () => {
      vi.useFakeTimers();
      const f = await readerWithHistory(12);
      const { t, readerLibraryId } = f;
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
      });
      const old = (await rebuildState(t))?.stepToken;
      expect(old).toBeDefined();
      await setStatus(f, "disabled");
      await setStatus(f, "active");
      const before = await rebuildState(t);
      expect(before?.stepToken).not.toBe(old);
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
        token: old,
      });
      expect(await rebuildState(t)).toEqual(before);
      expect(await pending(t)).toHaveLength(1);
      vi.useRealTimers();
    });

    it("schedules nothing extra for live writes during a healthy rebuild", async () => {
      vi.useFakeTimers();
      const { t, readerLibraryId, live } = await readerWithHistory(12);
      await t.mutation(internal.feedStats.backfill, {
        userId: readerLibraryId,
      });
      expect(await pending(t)).toHaveLength(1);
      for (let i = 0; i < 10; i++) await live();
      expect(await pending(t)).toHaveLength(1);
      await finish(t);
      expect(
        (await t.run((ctx) => ctx.db.query("feedStats").unique()))?.opened,
      ).toBe(22);
      vi.useRealTimers();
    });
  });

  it("does not count again what an earlier version already counted", async () => {
    vi.useFakeTimers();
    const { t, feedId, seed, live, opened, sessionId } = await setup();
    // History decided before the counters existed, and its feedStats row
    await seed([{ sessionId, feedCounted: true }]);
    await t.run((ctx) =>
      ctx.db.insert("feedStats", {
        userId: OWNER,
        feedId: feedId as Id<"feeds">,
        offered: 0,
        opened: 1,
        finished: 0,
        skipped: 0,
        updatedAt: Date.now(),
      }),
    );
    await live("opened", { sessionId, visitId: VISIT(1) });
    // The stale count stays until the rebuild replaces it; nothing is added
    expect(await opened()).toBe(1);
    await finish(t);
    expect(await opened()).toBe(1);
    await live("opened", { sessionId });
    expect(await opened()).toBe(2);
    vi.useRealTimers();
  });
});
