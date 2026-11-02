import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { libraryIsActive } from "./access";
import { type MutationCtx, mutation, type QueryCtx, query } from "./functions";
import { mergePageCredit, type PageCredit } from "./lib/readingActivity";
import {
  cellWeights,
  coverageWords,
  emptyCoverage,
  MAX_PAGE_CELLS,
  MAX_PAGE_PARAGRAPHS,
  MAX_PAGE_WORDS,
  pageSourceKey,
  scheduledGoal,
  unionCoverage,
  validCoverage,
} from "./lib/readingPages";
import { dayKey } from "./lib/statsPeriod";

type Ctx = MutationCtx | QueryCtx;
const settings = (ctx: Ctx, userId: string) =>
  ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
const dayRow = (ctx: Ctx, userId: string, day: string) =>
  ctx.db
    .query("readingPageDays")
    .withIndex("by_userId_and_day", (q) =>
      q.eq("userId", userId).eq("day", day),
    )
    .unique();
function schedule(row: Doc<"userSettings"> | null) {
  return {
    goalWords: row?.pageGoalWords ?? null,
    pendingGoalWords: row?.pendingPageGoalWords,
    pendingGoalDay: row?.pendingPageGoalDay,
  };
}
function tomorrow(day: string) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
async function initialize(ctx: MutationCtx, userId: string, timeZone: string) {
  if (!(await libraryIsActive(ctx, userId)))
    throw new Error("This library is no longer active.");
  dayKey(Date.now(), timeZone); // Reject invalid IANA zones.
  const row = await settings(ctx, userId);
  if (row?.pageTimeZone) return row;
  const patch = {
    pageTimeZone: timeZone,
    pagesTrackedFrom: dayKey(Date.now(), timeZone),
    updatedAt: Date.now(),
  };
  if (row) {
    await ctx.db.patch(row._id, patch);
    return { ...row, ...patch };
  }
  const id = await ctx.db.insert("userSettings", { userId, ...patch });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Reading settings could not be saved.");
  return created;
}

/** Freeze today's target before reading; offline future days carry this known schedule. */
export const initializeDay = mutation({
  args: { timeZone: v.string() },
  handler: async (ctx, args) => {
    const row = await initialize(ctx, ctx.readerId, args.timeZone);
    const zone = row.pageTimeZone ?? args.timeZone;
    const day = dayKey(Date.now(), zone);
    if (!(await dayRow(ctx, ctx.readerId, day)))
      await ctx.db.insert("readingPageDays", {
        userId: ctx.readerId,
        day,
        timeZone: zone,
        creditedWords: 0,
        goalWords: scheduledGoal(schedule(row), day),
      });
    return null;
  },
});

export const prepareSource = mutation({
  args: {
    articleId: v.id("articles"),
    sourceKey: v.string(),
    paragraphWords: v.array(v.number()),
    timeZone: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await initialize(ctx, ctx.readerId, args.timeZone);
    const article = await ctx.db.get(args.articleId);
    if (!article || article.userId !== ctx.readerId)
      throw new Error("Article not found.");
    if (article.bookUnitCount !== undefined)
      return { unavailable: "Books do not count toward estimated pages yet." };
    if (args.sourceKey !== pageSourceKey(article.content, article.contentHtml))
      return {
        unavailable:
          "Updated text is not tracked yet. Reopen the article to retry.",
      };
    const words = args.paragraphWords;
    const total = words.reduce((sum, n) => sum + n, 0);
    if (
      !words.length ||
      words.length > MAX_PAGE_PARAGRAPHS ||
      words.some((n) => !Number.isSafeInteger(n) || n < 1) ||
      total > MAX_PAGE_WORDS ||
      total < 1 ||
      (article.wordCount !== undefined && total > article.wordCount * 1.1 + 32)
    )
      return { unavailable: "Estimated pages are unavailable for this text." };
    const old = await ctx.db
      .query("readingPageSources")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", article._id),
      )
      .unique();
    if (
      old &&
      (old.sourceKey !== args.sourceKey ||
        JSON.stringify(old.paragraphWords) !== JSON.stringify(words))
    )
      return {
        unavailable:
          "Updated text is not tracked yet; earlier pages are preserved.",
      };
    const weights = cellWeights(words);
    if (weights.length > MAX_PAGE_CELLS)
      return { unavailable: "Estimated pages are unavailable for this text." };
    const id =
      old?._id ??
      (await ctx.db.insert("readingPageSources", {
        userId: ctx.readerId,
        articleId: article._id,
        sourceKey: args.sourceKey,
        method: "visible-cells-v1",
        wordCount: total,
        paragraphWords: words,
        coverage: emptyCoverage(weights.length),
        creditedWords: 0,
      }));
    return {
      sourceId: id,
      coverage: old?.coverage ?? emptyCoverage(weights.length),
      paragraphWords: words,
      timeZone: row.pageTimeZone ?? args.timeZone,
      ...schedule(row),
    };
  },
});

/** Called only inside the authenticated checkpoint transaction. */
export async function savePageCredit(
  ctx: MutationCtx,
  userId: string,
  article: Doc<"articles">,
  input: {
    day: string;
    startedAt: number;
    updatedAt: number;
    activeTimeMs: number;
    pageCredit?: PageCredit;
  },
  old?: PageCredit,
) {
  const incoming = input.pageCredit;
  if (!incoming || article.bookUnitCount !== undefined) return old;
  const id = ctx.db.normalizeId("readingPageSources", incoming.sourceId);
  const source = id ? await ctx.db.get(id) : null;
  const row = await settings(ctx, userId);
  if (
    !source ||
    source.userId !== userId ||
    source.articleId !== article._id ||
    incoming.timeZone !== row?.pageTimeZone ||
    (old && old.sourceId !== incoming.sourceId)
  )
    return old;
  // Midnight endpoints belong to the day that just ended. A new day gets a new sample.
  if (
    dayKey(input.startedAt, incoming.timeZone) !== input.day ||
    dayKey(
      Math.max(input.startedAt, input.updatedAt - 1),
      incoming.timeZone,
    ) !== input.day
  )
    return old;
  const weights = cellWeights(source.paragraphWords);
  if (!validCoverage(incoming.coverage, weights.length)) return old;
  const merged = mergePageCredit(old, incoming);
  if (
    !merged ||
    merged.visualTimeMs > input.activeTimeMs ||
    coverageWords(merged.coverage, weights) >
      (merged.visualTimeMs * 220) / 60_000 + 0.00001
  )
    return old;
  const coverage = unionCoverage(source.coverage, merged.coverage);
  const creditedWords = coverageWords(coverage, weights);
  const delta = creditedWords - source.creditedWords;
  if (delta > 0) {
    const daily = await dayRow(ctx, userId, input.day);
    const goalWords = daily?.goalWords ?? (daily ? null : incoming.goalWords);
    const total = (daily?.creditedWords ?? 0) + delta;
    const patch = {
      creditedWords: total,
      achievedAt:
        daily?.achievedAt ??
        (goalWords !== null && total >= goalWords ? Date.now() : undefined),
    };
    if (daily) await ctx.db.patch(daily._id, patch);
    else
      await ctx.db.insert("readingPageDays", {
        userId,
        day: input.day,
        timeZone: incoming.timeZone,
        goalWords,
        ...patch,
      });
    await ctx.db.patch(source._id, { coverage, creditedWords });
  }
  return merged;
}

export const overview = query({
  args: {
    timeZone: v.string(),
    today: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await settings(ctx, ctx.readerId);
    const timeZone = row?.pageTimeZone ?? args.timeZone;
    const today = dayKey(Date.now(), timeZone);
    if (args.days !== undefined && !Number.isFinite(args.days))
      throw new Error("Choose a finite history range.");
    const days = Math.min(90, Math.max(1, Math.floor(args.days ?? 30)));
    const start = new Date(
      Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const history = await ctx.db
      .query("readingPageDays")
      .withIndex("by_userId_and_day", (q) =>
        q.eq("userId", ctx.readerId).gte("day", start).lte("day", today),
      )
      .take(90);
    return {
      today,
      timeZone,
      trackedFrom: row?.pagesTrackedFrom ?? null,
      visible: row?.pageGoalVisible ?? false,
      ...schedule(row),
      history: history.map(
        ({ day, creditedWords, goalWords, achievedAt, presentedAt }) => ({
          day,
          creditedWords,
          goalWords,
          achievedAt,
          presentedAt,
        }),
      ),
    };
  },
});

export const setGoal = mutation({
  args: { pages: v.union(v.number(), v.null()), timeZone: v.string() },
  handler: async (ctx, args) => {
    if (
      args.pages !== null &&
      (!Number.isInteger(args.pages) || args.pages < 1 || args.pages > 1000)
    )
      throw new Error(
        "Choose a whole-page goal from 1 to 1,000, or turn it off.",
      );
    const row = await initialize(ctx, ctx.readerId, args.timeZone);
    const day = dayKey(Date.now(), row.pageTimeZone ?? args.timeZone);
    const todayRow = await dayRow(ctx, ctx.readerId, day);
    const first = !row.pageGoalEverEnabled && args.pages !== null;
    const goalWords = args.pages === null ? null : args.pages * 300;
    const current = scheduledGoal(schedule(row), day);
    await ctx.db.patch(row._id, {
      pageGoalVisible: args.pages !== null,
      pageGoalEverEnabled: row.pageGoalEverEnabled || first,
      pageGoalWords: first ? goalWords : current,
      pendingPageGoalWords: goalWords,
      pendingPageGoalDay: tomorrow(day),
      updatedAt: Date.now(),
    });
    if (first) {
      if (todayRow)
        await ctx.db.patch(todayRow._id, {
          goalWords,
          achievedAt:
            goalWords !== null && todayRow.creditedWords >= goalWords
              ? Date.now()
              : undefined,
        });
      else
        await ctx.db.insert("readingPageDays", {
          userId: ctx.readerId,
          day,
          timeZone: row.pageTimeZone ?? args.timeZone,
          creditedWords: 0,
          goalWords,
        });
    }
    return null;
  },
});

export const claimCelebration = mutation({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    const row = await settings(ctx, ctx.readerId);
    if (
      !row?.pageTimeZone ||
      !row.pageGoalVisible ||
      args.day !== dayKey(Date.now(), row.pageTimeZone)
    )
      return false;
    const daily = await dayRow(ctx, ctx.readerId, args.day);
    if (!daily?.achievedAt || daily.presentedAt) return false;
    await ctx.db.patch(daily._id, { presentedAt: Date.now() });
    return true;
  },
});
