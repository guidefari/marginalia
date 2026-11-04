import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { libraryIsActive, ownedArticle } from "./access";
import { unitSummaries } from "./bookIndex";
import { deleteFile, liveImport, markImportReady } from "./documentImports";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./functions";
import { MAX_ANNOTATION_RETRIES } from "./lib/annotationPolicy";
import { advanceProgress, nextUnitIndex } from "./lib/bookPicks";
import { readerProviders } from "./lib/readerAI";
import { queueLibraryIndex } from "./libraryIndex";
import { spendReaderLimit } from "./limits";
import { updateQueueStats } from "./readingQueue";

// Annotation follows the reading: the unit being read, and the next one once
// the reader is well into this one (D-DES-055)
const ANNOTATE_NEXT_FROM_PERCENT = 60;

const outlineEntry = v.object({
  title: v.string(),
  minutes: v.number(),
  chapter: v.optional(v.string()),
});

const unitFields = {
  sourceSpans: v.optional(
    v.array(
      v.object({
        spineIndex: v.number(),
        start: v.number(),
        end: v.number(),
      }),
    ),
  ),
  index: v.number(),
  title: v.string(),
  chapter: v.optional(v.string()),
  content: v.string(),
  contentHtml: v.string(),
  wordCount: v.number(),
  estimatedReadMinutes: v.number(),
};

async function bookRow(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
) {
  return ctx.db
    .query("books")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", userId).eq("articleId", articleId),
    )
    .unique();
}

async function unitRow(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
  index: number,
) {
  return ctx.db
    .query("bookUnits")
    .withIndex("by_userId_and_articleId_and_index", (q) =>
      q.eq("userId", userId).eq("articleId", articleId).eq("index", index),
    )
    .unique();
}

/** Whether a unit's margin should be (re)started: waiting, failed with retries left, or skipped for want of a provider that now exists. */
async function wantsAnnotation(ctx: MutationCtx, unit: Doc<"bookUnitStatus">) {
  switch (unit.annotationStatus) {
    case "deferred":
      return true;
    case "failed":
      return (unit.annotationRetries ?? 0) < MAX_ANNOTATION_RETRIES;
    case "skipped":
      return (
        unit.skipReason === "no_provider" &&
        (await readerProviders(ctx, unit.userId)).providers.length > 0
      );
    default:
      return false;
  }
}

/** Starts a unit's margin if it needs one, within the reader's lookahead budget. */
async function startUnitAnnotation(
  ctx: MutationCtx,
  unit: Doc<"bookUnitStatus">,
) {
  if (!(await wantsAnnotation(ctx, unit))) return;
  if (!(await spendReaderLimit(ctx, unit.userId, "annotateAhead"))) return;
  const fields = {
    annotationStatus: "pending" as const,
    skipReason: undefined,
    annotationRetries:
      unit.annotationStatus === "failed"
        ? (unit.annotationRetries ?? 0) + 1
        : unit.annotationRetries,
  };
  await ctx.db.patch("bookUnits", unit.unitId, fields);
  await ctx.db.patch("bookUnitStatus", unit._id, fields);
  await ctx.scheduler.runAfter(0, internal.actions.annotateUnit.generate, {
    articleId: unit.articleId,
    unitIndex: unit.index,
  });
}

export async function syncUnitMetadata(
  ctx: MutationCtx,
  unit: Doc<"bookUnits">,
) {
  const old = await ctx.db
    .query("bookUnitStatus")
    .withIndex("by_userId_and_articleId_and_index", (q) =>
      q
        .eq("userId", unit.userId)
        .eq("articleId", unit.articleId)
        .eq("index", unit.index),
    )
    .unique();
  const fields = {
    userId: unit.userId,
    articleId: unit.articleId,
    index: unit.index,
    unitId: unit._id,
    annotationStatus: unit.annotationStatus,
    skipReason: unit.skipReason,
    annotationRetries: unit.annotationRetries,
  };
  const id = old?._id ?? (await ctx.db.insert("bookUnitStatus", fields));
  if (old) await ctx.db.patch("bookUnitStatus", id, fields);
  const stored = await ctx.db.get("bookUnitStatus", id);
  if (!stored) throw new Error("Unit metadata wasn't saved");
  return stored;
}
async function unitMetadata(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
  index: number,
) {
  const metadata = await ctx.db
    .query("bookUnitStatus")
    .withIndex("by_userId_and_articleId_and_index", (q) =>
      q.eq("userId", userId).eq("articleId", articleId).eq("index", index),
    )
    .unique();
  if (metadata) return metadata;
  // Mixed old data: at most the current/next body once, never a book-wide scan.
  const unit = await unitRow(ctx, userId, articleId, index);
  return unit ? syncUnitMetadata(ctx, unit) : null;
}

/** Explicit resumable migration: at most eight legacy bodies per transaction. */
export const backfillUnitMetadata = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    fromIndex: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.fromIndex) || args.fromIndex < 0)
      throw new Error("Invalid cursor");
    if (!(await libraryIsActive(ctx, args.userId))) return null;
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.userId))
      .first();
    if (reader?.deletingAt !== undefined) return null;
    if (!(await ownedArticle(ctx, args.articleId, args.userId))) return null;
    const units = await ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .gte("index", args.fromIndex),
      )
      .take(8);
    for (const unit of units) await syncUnitMetadata(ctx, unit);
    return {
      done: units.length < 8,
      nextIndex: (units.at(-1)?.index ?? args.fromIndex - 1) + 1,
    };
  },
});

/**
 * Moves a book's finished flag with its article's finishedAt, which archive,
 * restore and reading to the end all change. Restoring a book that was read to
 * the end starts it again; restoring an archived one keeps its place.
 */
export async function syncBookFinished(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
  finished: boolean,
) {
  const book = await bookRow(ctx, userId, articleId);
  if (!book) return;
  if (finished) {
    if (book.finished !== true)
      await ctx.db.patch("books", book._id, { finished: true });
    return;
  }
  const readToEnd = book.finishedThrough >= book.unitCount - 1;
  await ctx.db.patch("books", book._id, {
    finished: false,
    ...(readToEnd
      ? { finishedThrough: -1, furthestUnit: -1, furthestScroll: 0 }
      : {}),
  });
}

// --- What the reader and the desk read ---

/** A book's outline and where the reader is in it. */
export const get = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, ctx.readerId);
    if (!article?.bookOutline) return null;
    const book = await bookRow(ctx, ctx.readerId, article._id);
    if (!book) return null;
    return {
      outline: article.bookOutline,
      // Each part's one-line summary once it exists, by part; null until then
      summaries: await unitSummaries(ctx, ctx.readerId, article._id),
      finishedThrough: book.finishedThrough,
      furthestUnit: book.furthestUnit,
      furthestScroll: book.furthestScroll,
      furthestParagraph: book.furthestParagraph,
      nextUnit: Math.min(
        nextUnitIndex(book),
        Math.max(0, article.bookOutline.length - 1),
      ),
    };
  },
});

/** One reading unit's text. Only the reader's own. */
export const unit = query({
  args: { articleId: v.id("articles"), index: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.index) || args.index < 0) return null;
    return unitRow(ctx, ctx.readerId, args.articleId, args.index);
  },
});

/**
 * Records where the reader is in a unit. It only moves forward, starts the
 * unit's margin if it was waiting, and the next unit's once the reader is well
 * into this one. Reading the last unit to its end finishes the book.
 */
export const recordProgress = mutation({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.number(),
    // Additive identity fence; old clients still send only their index.
    unitKey: v.optional(v.string()),
    scrollPercent: v.number(),
    // The paragraph at the top of the view, kept with the furthest place
    paragraphIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, ctx.readerId);
    const book = article ? await bookRow(ctx, ctx.readerId, article._id) : null;
    if (!article || !book) throw new Error("Book not found");
    if (
      !Number.isInteger(args.unitIndex) ||
      args.unitIndex < 0 ||
      args.unitIndex >= book.unitCount ||
      !Number.isFinite(args.scrollPercent)
    )
      throw new ConvexError("That part isn't in this book.");
    const scrollPercent = Math.min(100, Math.max(0, args.scrollPercent));
    const current = await unitMetadata(
      ctx,
      ctx.readerId,
      article._id,
      args.unitIndex,
    );
    if (args.unitKey !== undefined && current?.unitId !== args.unitKey)
      throw new ConvexError(
        "This part has changed. Reopen it to save your place.",
      );

    const next = advanceProgress(book, {
      unitIndex: args.unitIndex,
      scrollPercent,
    });
    const moved =
      next.furthestUnit !== book.furthestUnit ||
      next.furthestScroll !== book.furthestScroll;
    const changed = moved || next.finishedThrough !== book.finishedThrough;
    if (changed)
      await ctx.db.patch("books", book._id, {
        ...next,
        // The paragraph belongs to the place it was measured at
        ...(moved
          ? {
              furthestParagraph:
                Number.isInteger(args.paragraphIndex) &&
                (args.paragraphIndex ?? -1) >= 0
                  ? args.paragraphIndex
                  : undefined,
            }
          : {}),
        lastReadAt: Date.now(),
      });

    if (current) await startUnitAnnotation(ctx, current);
    if (scrollPercent >= ANNOTATE_NEXT_FROM_PERCENT) {
      const following = await unitMetadata(
        ctx,
        ctx.readerId,
        article._id,
        args.unitIndex + 1,
      );
      if (following) await startUnitAnnotation(ctx, following);
    }

    if (
      next.finishedThrough >= book.unitCount - 1 &&
      article.finishedAt === undefined
    ) {
      await ctx.db.patch("articles", article._id, { finishedAt: Date.now() });
      const after = await ctx.db.get("articles", article._id);
      if (after) await updateQueueStats(ctx, article, after);
      await syncBookFinished(ctx, ctx.readerId, article._id, true);
    }
  },
});

// --- Internal, for actions/importPdf.ts and actions/annotateUnit.ts ---

/**
 * The article row of a book being imported. It stays "pending" and out of
 * every list until finishBook, so a failed import has nothing to find.
 */
export const createBookArticle = internalMutation({
  args: {
    importId: v.id("documentImports"),
    userId: v.string(),
    guid: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    excerpt: v.string(),
    fileName: v.string(),
    pageCount: v.optional(v.number()),
    wordCount: v.number(),
    estimatedReadMinutes: v.number(),
    outline: v.array(outlineEntry),
  },
  handler: async (ctx, { importId, outline, guid, fileName, ...article }) => {
    // The reader may have left while the PDF was being read
    const row = await liveImport(ctx, importId);
    if (!row || row.userId !== article.userId) return null;
    const articleId = await ctx.db.insert("articles", {
      ...article,
      guid,
      url: guid,
      uploadedFileName: fileName,
      bookUnitCount: outline.length,
      bookOutline: outline,
      extractionStatus: "pending",
      // The row itself is never annotated; each unit has its own margin
      annotationStatus: "skipped",
      createdAt: Date.now(),
    });
    // Recorded in the same transaction, so a timeout can always find and remove it
    await ctx.db.patch("documentImports", importId, {
      partialArticleId: articleId,
    });
    return articleId;
  },
});

export const addUnits = internalMutation({
  args: {
    importId: v.id("documentImports"),
    userId: v.string(),
    articleId: v.id("articles"),
    units: v.array(v.object(unitFields)),
  },
  handler: async (ctx, args) => {
    const row = await liveImport(ctx, args.importId);
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (row?.partialArticleId !== args.articleId || !article) return false;
    if (article.extractionStatus !== "pending")
      throw new Error("Book not found");
    for (const unit of args.units) {
      const id = await ctx.db.insert("bookUnits", {
        ...unit,
        userId: args.userId,
        articleId: args.articleId,
        annotationStatus: unit.index === 0 ? "pending" : "deferred",
      });
      const stored = await ctx.db.get("bookUnits", id);
      if (stored) await syncUnitMetadata(ctx, stored);
    }
    return true;
  },
});

/** Makes the book real: readable, in picks and in the library. */
export const finishBook = internalMutation({
  args: {
    importId: v.id("documentImports"),
    userId: v.string(),
    articleId: v.id("articles"),
    embedding: v.optional(v.array(v.float64())),
    // What the import row shows once it is ready
    title: v.string(),
    pages: v.optional(v.number()),
    units: v.number(),
    firstUnitTitle: v.string(),
    firstUnitMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await liveImport(ctx, args.importId);
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (row?.partialArticleId !== args.articleId || !article) return false;
    if (article.extractionStatus !== "pending" || !article.bookUnitCount)
      throw new Error("Book not found");
    await ctx.db.patch("articles", article._id, {
      extractionStatus: "extracted",
      embedding: args.embedding,
      embeddedAt: args.embedding ? Date.now() : undefined,
    });
    await ctx.db.insert("books", {
      userId: args.userId,
      articleId: article._id,
      unitCount: article.bookUnitCount,
      finishedThrough: -1,
      furthestUnit: -1,
      furthestScroll: 0,
      finished: false,
      createdAt: Date.now(),
    });
    // Published and ready in one commit
    await markImportReady(ctx, row, {
      articleId: article._id,
      title: args.title,
      pages: args.pages,
      units: args.units,
      firstUnitTitle: args.firstUnitTitle,
      firstUnitMinutes: args.firstUnitMinutes,
    });
    await queueLibraryIndex(ctx, article._id);
    // The first unit opens with its margin on the way
    await ctx.scheduler.runAfter(500, internal.actions.annotateUnit.generate, {
      articleId: article._id,
      unitIndex: 0,
    });
    // The summaries, the book's one point and the passages follow, paced
    await ctx.scheduler.runAfter(1_000, internal.bookIndex.start, {
      userId: args.userId,
      articleId: article._id,
    });
    return true;
  },
});

// Valid legacy units can approach 1 MiB. Selection and wrapped deletion read
// each body more than once; leave room for cards, parent and import metadata.
const DISCARD_BATCH = 4;

/** Removes a book that failed part-way: its units, then its rows. */
export const discardBook = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    // The import to release once nothing is left
    importId: v.optional(v.id("documentImports")),
  },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    // A stale import action must never clean up a book already published by
    // another delivery of that import. Optional indexing is not import work.
    if (article?.extractionStatus === "extracted") return;
    const images = await ctx.db
      .query("bookImages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(50);
    for (const image of images) {
      await deleteFile(ctx, image.storageId);
      await ctx.db.delete(image._id);
    }
    if (images.length === 50) {
      await ctx.scheduler.runAfter(0, internal.books.discardBook, args);
      return;
    }
    if (article) {
      const units = await ctx.db
        .query("bookUnits")
        .withIndex("by_userId_and_articleId_and_index", (q) =>
          q.eq("userId", args.userId).eq("articleId", args.articleId),
        )
        .take(DISCARD_BATCH);
      for (const unit of units) {
        const metadata = await ctx.db
          .query("bookUnitStatus")
          .withIndex("by_userId_and_articleId_and_index", (q) =>
            q
              .eq("userId", args.userId)
              .eq("articleId", args.articleId)
              .eq("index", unit.index),
          )
          .unique();
        if (metadata) await ctx.db.delete("bookUnitStatus", metadata._id);
        await ctx.db.delete("bookUnits", unit._id);
      }
      if (units.length === DISCARD_BATCH) {
        await ctx.scheduler.runAfter(0, internal.books.discardBook, args);
        return;
      }
      const book = await bookRow(ctx, args.userId, args.articleId);
      if (book) await ctx.db.delete("books", book._id);
      await ctx.db.delete("articles", args.articleId);
      await ctx.scheduler.runAfter(0, internal.articleImportKeys.discard, {
        userId: args.userId,
        articleId: args.articleId,
      });
    }
    if (args.importId) {
      const row = await ctx.db.get("documentImports", args.importId);
      if (row?.partialArticleId)
        await ctx.db.patch("documentImports", args.importId, {
          partialArticleId: undefined,
        });
    }
  },
});

/** A unit with its book, read under the book's own library. */
export const unitForAnnotation = internalQuery({
  args: { articleId: v.id("articles"), unitIndex: v.number() },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article?.bookOutline) return null;
    const unit = await unitRow(
      ctx,
      article.userId,
      article._id,
      args.unitIndex,
    );
    return unit ? { article, unit } : null;
  },
});

export const setUnitStatus = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("deferred"),
    ),
    skipReason: v.optional(v.literal("no_provider")),
  },
  handler: async (ctx, args) => {
    const unit = await unitRow(
      ctx,
      args.userId,
      args.articleId,
      args.unitIndex,
    );
    if (unit) {
      await ctx.db.patch("bookUnits", unit._id, {
        skipReason: args.status === "skipped" ? args.skipReason : undefined,
        annotationStatus: args.status,
      });
      const stored = await ctx.db.get("bookUnits", unit._id);
      if (stored) await syncUnitMetadata(ctx, stored);
    }
  },
});
