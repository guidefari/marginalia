import { v } from "convex/values";
import { ownedArticle, ownedArticleCard } from "./access";
import { unitSummaries } from "./bookIndex";
import { query } from "./functions";
import { nextUnitIndex } from "./lib/bookPicks";
import { readerArticle } from "./lib/readerArticle";

export const readerKey = query({ args: {}, handler: (ctx) => ctx.readerId });

/** Authorized kind + chosen readable text in one client round trip. */
export const get = query({
  args: { articleId: v.id("articles"), unitIndex: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const doc = await ownedArticle(ctx, args.articleId, ctx.readerId);
    if (!doc) return null;
    const article = readerArticle(doc);
    const source = doc.feedId ? await ctx.db.get(doc.feedId) : null;
    const feed =
      source?.userId === ctx.readerId
        ? { _id: source._id, title: source.title, isActive: source.isActive }
        : null;
    // Resolve the calendar before the first checkpoint, not when coverage prepares later.
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    const readingTimeZone = settings?.pageTimeZone;
    if (doc.bookUnitCount === undefined)
      return {
        article,
        feed,
        readingTimeZone,
        isBook: false,
        unitIndex: null,
        unitKey: null,
        unitTitle: null,
        missingUnit: false,
      };
    let index = args.unitIndex;
    if (index === undefined) {
      const progress = await ctx.db
        .query("books")
        .withIndex("by_userId_and_articleId", (q) =>
          q.eq("userId", ctx.readerId).eq("articleId", doc._id),
        )
        .unique();
      index = Math.min(
        progress ? nextUnitIndex(progress) : 0,
        Math.max(0, doc.bookUnitCount - 1),
      );
    }
    if (!Number.isInteger(index) || index < 0)
      throw new Error("Invalid book part");
    const unit = await ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("articleId", doc._id)
          .eq("index", index),
      )
      .unique();
    return {
      feed,
      readingTimeZone,
      article: unit
        ? {
            ...article,
            content: unit.content,
            contentHtml: unit.contentHtml,
            wordCount: unit.wordCount,
            estimatedReadMinutes: unit.estimatedReadMinutes,
            annotationStatus: unit.annotationStatus,
          }
        : null,
      isBook: true,
      unitIndex: index,
      unitKey: unit?._id ?? null,
      unitTitle: unit?.title ?? null,
      missingUnit: unit === null,
    };
  },
});

/** Stable outline/summaries never subscribe to the high-churn books progress row. */
export const outline = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ownedArticle(ctx, articleId, ctx.readerId);
    if (!article?.bookOutline) return null;
    return {
      outline: article.bookOutline,
      summaries: await unitSummaries(ctx, ctx.readerId, articleId),
    };
  },
});
export const progress = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    if (!(await ownedArticleCard(ctx, articleId, ctx.readerId))) return null;
    const book = await ctx.db
      .query("books")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", articleId),
      )
      .unique();
    return book
      ? {
          unit: book.furthestUnit,
          scroll: book.furthestScroll,
          paragraph: book.furthestParagraph,
        }
      : null;
  },
});
