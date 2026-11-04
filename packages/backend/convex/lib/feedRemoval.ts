import { getConvexSize, type Value, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { removeFromQueueStats } from "../readingQueue";
import { bumpFeedArticleCount } from "./feedArticleCount";
import {
  type CheckingRemoval,
  READER_DELETE_SPACING_MS,
  resumeFeedRemoval,
} from "./feedRemovalState";

/** What happens to a feed's articles when the reader unsubscribes. */
export const feedArticlesChoice = v.union(
  v.literal("keep"),
  v.literal("unread"),
  v.literal("all"),
);
export type FeedArticlesChoice = "keep" | "unread" | "all";

export interface ArticleUse {
  /** Highlights, notes, Ask threads, impressions or answered reflections */
  marked: boolean;
  /** Opened, finished, saved or loved */
  opened: boolean;
}

/**
 * Preview only: reserve room for auth/feed reads and one maximum-size source
 * row beyond the cutoff. Reads are serial, so no outstanding join can spend
 * that reserve again. This is not permission to delete an article.
 */
export class PreviewReadBudget {
  private bytes = 0;
  private reads = 0;

  async read<T extends Value>(
    load: () => Promise<T | null>,
  ): Promise<T | null | undefined> {
    if (this.bytes >= 8 * 1024 * 1024 || this.reads >= 3600) return undefined;
    this.reads++;
    const row = await load();
    if (row !== null) this.bytes += getConvexSize(row);
    return row;
  }
}

/** Unknown means the article must not contribute to either removal count. */
export async function previewArticleUse(
  ctx: QueryCtx,
  article: Doc<"articles">,
  budget: PreviewReadBudget,
): Promise<ArticleUse | null> {
  for (const table of [
    "highlights",
    "userNotes",
    "companionThreads",
    "impressions",
  ] as const) {
    const mark = await budget.read(() =>
      ctx.db
        .query(table)
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .first(),
    );
    if (mark === undefined) return null;
    if (mark) return { marked: true, opened: false };
  }

  const reflections = ctx.db
    .query("reflections")
    .withIndex("by_article", (q) => q.eq("articleId", article._id))
    [Symbol.asyncIterator]();
  while (true) {
    const reflection = await budget.read(async () => {
      const next = await reflections.next();
      return next.done ? null : next.value;
    });
    if (reflection === undefined) return null;
    if (reflection === null) break;
    if (reflection.userResponse !== undefined)
      return { marked: true, opened: false };
  }

  if (article.finishedAt !== undefined) return { marked: false, opened: true };
  for (const action of ["opened", "finished"] as const) {
    const interaction = await budget.read(() =>
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user_article_action", (q) =>
          q
            .eq("userId", article.userId)
            .eq("articleId", article._id)
            .eq("action", action),
        )
        .first(),
    );
    if (interaction === undefined) return null;
    if (interaction) return { marked: false, opened: true };
  }
  for (const table of [
    "readingActivity",
    "savedArticles",
    "lovedArticles",
  ] as const) {
    const interaction = await budget.read(() =>
      ctx.db
        .query(table)
        .withIndex("by_user_article", (q) =>
          q.eq("userId", article.userId).eq("articleId", article._id),
        )
        .first(),
    );
    if (interaction === undefined) return null;
    if (interaction) return { marked: false, opened: true };
  }
  return { marked: false, opened: false };
}

export async function articleUse(
  ctx: QueryCtx,
  article: Doc<"articles">,
): Promise<ArticleUse> {
  const byArticle = (
    table: "highlights" | "userNotes" | "companionThreads" | "impressions",
  ) =>
    ctx.db
      .query(table)
      .withIndex("by_article", (q) => q.eq("articleId", article._id))
      .first();
  const byUserArticle = (
    table: "savedArticles" | "lovedArticles" | "readingActivity",
  ) =>
    ctx.db
      .query(table)
      .withIndex("by_user_article", (q) =>
        q.eq("userId", article.userId).eq("articleId", article._id),
      )
      .first();
  const interaction = (action: "opened" | "finished") =>
    ctx.db
      .query("articleInteractions")
      .withIndex("by_user_article_action", (q) =>
        q
          .eq("userId", article.userId)
          .eq("articleId", article._id)
          .eq("action", action),
      )
      .first();

  const [highlight, note, thread, impression, reflections] = await Promise.all([
    byArticle("highlights"),
    byArticle("userNotes"),
    byArticle("companionThreads"),
    byArticle("impressions"),
    ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", article._id))
      .collect(),
  ]);
  const marked =
    !!(highlight || note || thread || impression) ||
    reflections.some((r) => r.userResponse !== undefined);

  const opened =
    article.finishedAt !== undefined ||
    (
      await Promise.all([
        interaction("opened"),
        interaction("finished"),
        byUserArticle("readingActivity"),
        byUserArticle("savedArticles"),
        byUserArticle("lovedArticles"),
      ])
    ).some(Boolean);

  return { marked, opened };
}

export function removes(choice: FeedArticlesChoice, use: ArticleUse): boolean {
  if (choice === "keep" || use.marked) return false;
  return choice === "all" || !use.opened;
}

/** The non-reflection protection policy, rechecked in the final deletion
 * transaction. Reflection absence requires the separate complete current-job
 * scan; this helper alone is NEVER deletion authority. */
export async function articleUseWithoutReflections(
  ctx: QueryCtx,
  article: Doc<"articles">,
): Promise<ArticleUse> {
  for (const table of [
    "highlights",
    "userNotes",
    "companionThreads",
    "impressions",
  ] as const) {
    if (
      await ctx.db
        .query(table)
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .first()
    )
      return { marked: true, opened: false };
  }
  if (article.finishedAt !== undefined) return { marked: false, opened: true };
  for (const action of ["opened", "finished"] as const) {
    if (
      await ctx.db
        .query("articleInteractions")
        .withIndex("by_user_article_action", (q) =>
          q
            .eq("userId", article.userId)
            .eq("articleId", article._id)
            .eq("action", action),
        )
        .first()
    )
      return { marked: false, opened: true };
  }
  for (const table of [
    "readingActivity",
    "savedArticles",
    "lovedArticles",
  ] as const) {
    if (
      await ctx.db
        .query(table)
        .withIndex("by_user_article", (q) =>
          q.eq("userId", article.userId).eq("articleId", article._id),
        )
        .first()
    )
      return { marked: false, opened: true };
  }
  return { marked: false, opened: false };
}

/**
 * Production caller must consume its complete current proof in this transaction.
 * Delete the source
 * now and discard its generated material in bounded follow-up transactions.
 * Reading history stays so statistics don't change; readers skip the gone ID.
 */
export async function finishFeedArticleProof(
  ctx: MutationCtx,
  job: CheckingRemoval,
  article: Doc<"articles">,
) {
  const run = await ctx.db.get(job.runId);
  if (run?.phase !== "feed" || run.currentJobId !== job._id)
    throw new Error("Removal run no longer owns this proof");
  await deleteArticle(ctx, article, job._id);
  let readerDeletes = job.readerDeletes;
  if (article.readerDocumentId)
    await ctx.scheduler.runAfter(
      readerDeletes++ * READER_DELETE_SPACING_MS,
      internal.actions.readwiseSync.deleteReaderDocument,
      { userId: job.userId, readerDocumentId: article.readerDocumentId },
    );
  await resumeFeedRemoval(ctx, job, readerDeletes);
}

export async function deleteArticle(
  ctx: MutationCtx,
  article: Doc<"articles">,
  proofId?: Id<"feedArticleCleanup">,
): Promise<void> {
  const current = await ctx.db.get(article._id);
  if (!current) return;
  if (current.userId !== article.userId)
    throw new Error("Article ownership changed");
  // Transition before parent deletion, so the source lifecycle hook preserves
  // the post-delete claim. Direct helper fixtures without a proof create only
  // cleanup; production removal supplies its owned checking job.
  let jobId = proofId;
  const cleanup = {
    userId: article.userId,
    articleId: article._id,
    phase: "annotations" as const,
  };
  if (jobId) {
    const proof = await ctx.db.get(jobId);
    if (
      proof?.phase !== "checking" ||
      proof.articleId !== article._id ||
      proof.userId !== article.userId
    )
      throw new Error("Removal proof unavailable");
    await ctx.db.replace(jobId, cleanup);
  } else jobId = await ctx.db.insert("feedArticleCleanup", cleanup);
  // Looked-up words are the reader's own and stay; only their link goes. Done
  // in its own transactions, because a feed removal deletes many articles in
  // one and each can have hundreds of lookups.
  await ctx.scheduler.runAfter(0, internal.lookups.markArticleGone, {
    userId: article.userId,
    articleId: article._id,
  });
  // Cached passage vectors are large; they go in batches of their own
  await ctx.scheduler.runAfter(0, internal.articlePassages.discard, {
    userId: article.userId,
    articleId: article._id,
  });
  await removeFromQueueStats(ctx, article);
  await ctx.db.delete("articles", article._id);
  await ctx.scheduler.runAfter(0, internal.bookImages.discard, {
    userId: article.userId,
    articleId: article._id,
  });
  // Parent absence immediately fences publication and reader access. Each
  // cleanup transaction reads/deletes at most one potentially 1 MiB child;
  // generic writer pre/post reads are included in that bound.
  await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.discard, {
    jobId,
  });
  await ctx.scheduler.runAfter(0, internal.articleImportKeys.discard, {
    userId: article.userId,
    articleId: article._id,
  });
  await bumpFeedArticleCount(ctx, article.feedId, article.userId, -1);
  // A deleted article only removes a candidate connection, which adds nothing
  // for the margin to read, so it deliberately doesn't move the fingerprint.
}
