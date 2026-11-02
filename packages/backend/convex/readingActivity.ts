import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { libraryIsActive, ownedArticleCard } from "./access";
import { countFeedOutcome } from "./feedStats";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./functions";
import { WORDS_PER_MINUTE } from "./lib/constants";
import {
  capDwell,
  furthestParagraph,
  hasReadArticle,
  mergeDwell,
  furthestPlace as pickFurthestPlace,
  type ReadingCheckpoint,
  readingCheckpointSchema,
} from "./lib/readingActivity";
import { initializeEmptyResume, mergeResume } from "./lib/readingResume";
import { ensureReadingSession } from "./lib/readingSession";
import { savePageCredit } from "./readingPages";
import { updateQueueStats } from "./readingQueue";
import { queueTasteRefresh } from "./taste";

const args = {
  articleId: v.string(),
  sessionId: v.optional(v.string()),
  sessionKey: v.optional(v.string()),
  requestedMinutes: v.optional(v.number()),
  visitId: v.string(),
  day: v.string(),
  startedAt: v.number(),
  updatedAt: v.number(),
  activeTimeMs: v.number(),
  visibleTimeMs: v.number(),
  timeSpentMs: v.number(),
  maxScrollPercent: v.number(),
  paragraphIndex: v.optional(v.number()),
  annotationsOpened: v.array(v.string()),
  finished: v.optional(v.boolean()),
  // Cumulative milliseconds per displayed paragraph number
  dwell: v.optional(v.record(v.string(), v.number())),
  pageCredit: v.optional(
    v.object({
      sourceId: v.string(),
      coverage: v.string(),
      visualTimeMs: v.number(),
      timeZone: v.string(),
      goalWords: v.union(v.number(), v.null()),
    }),
  ),
};

async function saveCheckpoint(
  ctx: MutationCtx,
  input: ReadingCheckpoint,
  userId: string,
) {
  const s = readingCheckpointSchema.parse(input);
  // The internal path trusts a caller that authenticated before an account
  // deletion began, so a late checkpoint must not recreate purged rows
  if (!(await libraryIsActive(ctx, userId)))
    throw new Error("This library is no longer active.");
  const now = Date.now();
  if (s.updatedAt > now + 60_000 || s.updatedAt < s.startedAt)
    throw new Error("Check your device clock and try again.");
  const articleId = ctx.db.normalizeId("articles", s.articleId);
  const article = articleId ? await ctx.db.get(articleId) : null;
  if (!article || article.userId !== userId)
    throw new Error("Article not found");
  const keyedSessionId = s.sessionKey
    ? await ensureReadingSession(
        ctx,
        userId,
        s.sessionKey,
        s.requestedMinutes ?? 0,
      )
    : null;
  const sessionId = s.sessionId
    ? ctx.db.normalizeId("sessions", s.sessionId)
    : keyedSessionId;
  if (keyedSessionId && sessionId !== keyedSessionId)
    throw new Error("Session identity changed");
  if (s.sessionId && !sessionId) throw new Error("Invalid session");
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  if (sessionId && (!session || session.userId !== userId))
    throw new Error("Session not found");
  if (session?.articleId && session.articleId !== article._id)
    throw new Error("Session belongs to another article");
  const old = await ctx.db
    .query("readingActivity")
    .withIndex("by_user_visit_day", (q) =>
      q.eq("userId", userId).eq("visitId", s.visitId).eq("day", s.day),
    )
    .unique();
  if (old && (old.articleId !== article._id || old.startedAt !== s.startedAt))
    throw new Error("This reading visit belongs to another article or day.");
  if (old && old.sessionId !== (sessionId ?? undefined))
    throw new Error("Reading session changed");
  await initializeEmptyResume(ctx, userId);
  if (!old) {
    const previousDay = await ctx.db
      .query("readingActivity")
      .withIndex("by_user_visit_day", (q) =>
        q.eq("userId", userId).eq("visitId", s.visitId),
      )
      .first();
    if (
      previousDay &&
      (previousDay.articleId !== article._id ||
        previousDay.sessionId !== (sessionId ?? undefined))
    )
      throw new Error(
        "This reading visit belongs to another article or session.",
      );
    if (!previousDay)
      await countFeedOutcome(
        ctx,
        article,
        await ctx.db.insert("articleInteractions", {
          userId: userId,
          articleId: article._id,
          sessionId: sessionId ?? undefined,
          visitId: s.visitId,
          action: "opened",
          createdAt: s.startedAt,
        }),
      );
  }
  const activeTimeMs = Math.max(old?.activeTimeMs ?? 0, s.activeTimeMs);
  const visibleTimeMs = Math.max(old?.visibleTimeMs ?? 0, s.visibleTimeMs);
  const annotationsOpened = [
    ...new Set([...(old?.annotationsOpened ?? []), ...s.annotationsOpened]),
  ].slice(0, 128);
  const maxScrollPercent = Math.max(
    old?.maxScrollPercent ?? 0,
    s.maxScrollPercent,
  );
  // A delayed equal-progress delivery must not replace a newer paragraph;
  // exact timestamp ties converge independently of replay order.
  let incomingParagraph = s.paragraphIndex;
  if (
    old &&
    old.maxScrollPercent === s.maxScrollPercent &&
    s.updatedAt <= old.updatedAt
  ) {
    incomingParagraph = old.paragraphIndex ?? s.paragraphIndex;
    if (
      s.updatedAt === old.updatedAt &&
      old.paragraphIndex !== undefined &&
      s.paragraphIndex !== undefined
    )
      incomingParagraph = Math.max(old.paragraphIndex, s.paragraphIndex);
  }
  const paragraphIndex = furthestParagraph(old, {
    maxScrollPercent: s.maxScrollPercent,
    paragraphIndex: incomingParagraph,
  });
  // A book is finished by reading its last unit (books.recordProgress), not by
  // the time spent on any one visit
  const finishing =
    article.bookUnitCount === undefined &&
    !old?.finishedAt &&
    (Boolean(s.finished) ||
      (await readToTheEnd(ctx, article, old, {
        maxScrollPercent,
        activeTimeMs,
      })));
  const data = {
    userId: userId,
    articleId: article._id,
    sessionId: sessionId ?? undefined,
    visitId: s.visitId,
    day: s.day,
    startedAt: s.startedAt,
    updatedAt: Math.max(old?.updatedAt ?? 0, s.updatedAt),
    activeTimeMs,
    visibleTimeMs,
    timeSpentMs: Math.max(old?.timeSpentMs ?? 0, s.timeSpentMs),
    maxScrollPercent,
    paragraphIndex,
    annotationsOpened,
    finishedAt: old?.finishedAt ?? (finishing ? s.updatedAt : undefined),
    estimatedReadMinutes: article.estimatedReadMinutes,
    pageCredit: await savePageCredit(
      ctx,
      userId,
      article,
      { ...s, activeTimeMs },
      old?.pageCredit,
    ),
  };
  if (old) await ctx.db.patch(old._id, data);
  else await ctx.db.insert("readingActivity", data);
  await mergeResume(ctx, article, data, true);
  await saveDwell(ctx, data, s.dwell);
  if (session)
    await ctx.db.patch(session._id, {
      articleId: article._id,
      timeSpentMs:
        (session.timeSpentMs ?? 0) + activeTimeMs - (old?.activeTimeMs ?? 0),
      scrollPercentage: Math.max(
        session.scrollPercentage ?? 0,
        data.maxScrollPercent,
      ),
      readingStatus: finishing
        ? "completed"
        : session.readingStatus === "selecting"
          ? "reading"
          : session.readingStatus,
      endedAt: finishing ? now : session.endedAt,
    });
  if (finishing) {
    // Keep existing reading history and queue semantics, but exclude these
    // marker-only interactions from measured time in statistics. A visit
    // finishes once: its finish retried on another day (offline, across
    // midnight) has no row of its own to add.
    const alreadyFinished = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user_article_action", (q) =>
        q
          .eq("userId", userId)
          .eq("articleId", article._id)
          .eq("action", "finished"),
      )
      .filter((q) => q.eq(q.field("visitId"), s.visitId))
      .first();
    if (!alreadyFinished)
      await countFeedOutcome(
        ctx,
        article,
        await ctx.db.insert("articleInteractions", {
          userId: userId,
          articleId: article._id,
          sessionId: sessionId ?? undefined,
          action: "finished",
          visitId: s.visitId,
          createdAt: s.updatedAt,
        }),
      );
    if (article.finishedAt === undefined) {
      await queueTasteRefresh(ctx, userId);
      await ctx.db.patch(article._id, { finishedAt: s.updatedAt });
      const after = await ctx.db.get(article._id);
      if (after) await updateQueueStats(ctx, article, after);
      await ctx.scheduler.runAfter(
        0,
        internal.actions.readwiseSync.archiveArticle,
        { userId, articleId: article._id },
      );
    }
  }
  return null;
}

/** Folds this checkpoint's dwell into the visit's row; repeats and reordering change nothing. */
async function saveDwell(
  ctx: MutationCtx,
  visit: Pick<
    Doc<"readingActivity">,
    "userId" | "visitId" | "day" | "articleId" | "activeTimeMs" | "updatedAt"
  >,
  incoming: Record<string, number> | undefined,
) {
  if (!capDwell(incoming)) return;
  const old = await ctx.db
    .query("paragraphDwell")
    .withIndex("by_user_visit_day", (q) =>
      q
        .eq("userId", visit.userId)
        .eq("visitId", visit.visitId)
        .eq("day", visit.day),
    )
    .unique();
  const dwell = mergeDwell(old?.dwell, incoming, visit.activeTimeMs);
  if (!dwell) return;
  if (!old)
    await ctx.db.insert("paragraphDwell", {
      userId: visit.userId,
      visitId: visit.visitId,
      day: visit.day,
      articleId: visit.articleId,
      dwell,
      updatedAt: visit.updatedAt,
    });
  else if (JSON.stringify(old.dwell) !== JSON.stringify(dwell))
    await ctx.db.patch(old._id, {
      dwell,
      updatedAt: Math.max(old.updatedAt, visit.updatedAt),
    });
}

/**
 * Auto-finish fires once, on the checkpoint where the reading first crosses
 * the line. Marking an article unread mid-visit then sticks.
 */
async function readToTheEnd(
  ctx: MutationCtx,
  article: Doc<"articles">,
  old: Doc<"readingActivity"> | null,
  next: { maxScrollPercent: number; activeTimeMs: number },
) {
  if (article.finishedAt !== undefined || next.maxScrollPercent < 95)
    return false;
  const minutes =
    article.estimatedReadMinutes ??
    (Math.ceil((article.wordCount ?? 0) / WORDS_PER_MINUTE) || 1);
  const visits = await ctx.db
    .query("readingActivity")
    .withIndex("by_user_article", (q) =>
      q.eq("userId", article.userId).eq("articleId", article._id),
    )
    .take(200);
  const elsewhere = visits
    .filter((v) => v._id !== old?._id)
    .reduce((total, v) => total + v.activeTimeMs, 0);
  const before = old
    ? hasReadArticle(
        {
          maxScrollPercent: old.maxScrollPercent,
          activeTimeMs: elsewhere + old.activeTimeMs,
        },
        minutes,
      )
    : false;
  const now = hasReadArticle(
    {
      maxScrollPercent: next.maxScrollPercent,
      activeTimeMs: elsewhere + next.activeTimeMs,
    },
    minutes,
  );
  return now && !before;
}

export const checkpoint = mutation({
  args,
  handler: (ctx, input) => saveCheckpoint(ctx, input, ctx.readerId),
});
export const record = internalMutation({
  args: { ...args, userId: v.string() },
  handler: (ctx, { userId, ...input }) => saveCheckpoint(ctx, input, userId),
});

/**
 * How far the reader has got into an article across every visit, as a percent
 * of its body, or null when it is not theirs. The reader scrolls back to it on
 * reopening. Clients open during a deploy still read a number from this, so its
 * shape stays; `furthestPlace` adds the paragraph.
 */
export const furthest = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ownedArticleCard(ctx, args.articleId, ctx.readerId);
    if (!article) return null;
    return (await visitsOf(ctx, article)).reduce(
      (max, v) => Math.max(max, v.maxScrollPercent),
      0,
    );
  },
});

/**
 * The furthest place as a percent and the paragraph at the top of the view
 * there (absent on visits recorded before paragraphs were kept), or null when
 * the article is not theirs.
 */
export const furthestPlace = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ownedArticleCard(ctx, args.articleId, ctx.readerId);
    if (!article) return null;
    return pickFurthestPlace(await visitsOf(ctx, article));
  },
});

function visitsOf(
  ctx: QueryCtx,
  article: Pick<Doc<"articles">, "userId" | "_id">,
) {
  return ctx.db
    .query("readingActivity")
    .withIndex("by_user_article", (q) =>
      q.eq("userId", article.userId).eq("articleId", article._id),
    )
    .take(200);
}
