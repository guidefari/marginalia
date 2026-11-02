import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";

/** Per-reader fixed-window budgets, so one reader can't run up costs or spam checks. */
export const READER_LIMITS = {
  ai: {
    max: 30,
    windowMs: 60_000,
    message:
      "You're sending requests faster than this reader allows. Wait a minute and try again.",
  },
  providerKeySave: {
    max: 10,
    windowMs: 60 * 60_000,
    message: "Too many key changes in the last hour. Try again later.",
  },
  readwiseConnect: {
    max: 10,
    windowMs: 60 * 60_000,
    message:
      "Too many attempts to connect Readwise in the last hour. Try again later.",
  },
  chatgptConnect: {
    max: 10,
    windowMs: 60 * 60_000,
    message:
      "Too many attempts to connect ChatGPT in the last hour. Try again later.",
  },
  // Background catch-up batches (catchUp.ts), at most ten jobs each
  catchUp: {
    max: 30,
    windowMs: 60 * 60_000,
    message: "Catching up is paused for an hour to limit spend.",
  },
  // Requests made with a personal API token (apiTokens.ts)
  api: {
    max: 60,
    windowMs: 60_000,
    message: "Too many API requests in the last minute. Try again shortly.",
  },
  // Lookahead annotation requests from the desk (articles.annotateAhead)
  annotateAhead: {
    max: 30,
    windowMs: 60_000,
    message: "Annotating ahead is paused for a minute.",
  },
  apiTokenCreate: {
    max: 10,
    windowMs: 60 * 60_000,
    message: "Too many API tokens created in the last hour. Try again later.",
  },
  // PDF uploads and the imports started from them (documentImports.ts)
  pdfImport: {
    max: 20,
    windowMs: 60 * 60_000,
    message: "Too many PDFs in the last hour. Try again later.",
  },
  // Reading-alongside passes (rung 2f): about $0.25 a day on Haiku. Used up, the
  // margin just stops filling ahead; nothing is shown to the reader.
  alongsideDaily: {
    max: 130,
    windowMs: 24 * 60 * 60_000,
    message: "Reading alongside is resting until tomorrow.",
  },
  // Retrieval runs scheduled for reading-alongside passes. Never refunded:
  // a pass that ends without a model call still spent embeddings.
  alongsideRetrieval: {
    max: 40,
    windowMs: 24 * 60 * 60_000,
    message: "Reading alongside is resting until tomorrow.",
  },
  // Batches of a book's indexing jobs (bookIndex.ts), at most five each. A
  // 100-part book takes about forty; a longer one pauses and carries on.
  bookIndex: {
    max: 60,
    windowMs: 60 * 60_000,
    message: "Indexing books is paused for an hour to limit spend.",
  },
  // Clips read aloud (speech.ts), spent with the reader's own key
  speech: {
    max: 60,
    windowMs: 60_000,
    message: "Listening is paused for a minute to limit requests.",
  },
  speechPreparation: {
    max: 60,
    windowMs: 60_000,
    message: "Listening preparation is paused for a minute. Wait, then Retry.",
  },
} as const;

export type LimitBucket = keyof typeof READER_LIMITS;

const bucket = v.union(
  v.literal("ai"),
  v.literal("providerKeySave"),
  v.literal("readwiseConnect"),
  v.literal("chatgptConnect"),
  v.literal("catchUp"),
  v.literal("api"),
  v.literal("annotateAhead"),
  v.literal("apiTokenCreate"),
  v.literal("pdfImport"),
  v.literal("alongsideDaily"),
  v.literal("alongsideRetrieval"),
  v.literal("bookIndex"),
  v.literal("speech"),
  v.literal("speechPreparation"),
);

/** Spends one request from the reader's bucket; false when it's used up. */
export async function spendReaderLimit(
  ctx: MutationCtx,
  userId: string,
  name: LimitBucket,
): Promise<boolean> {
  const { max, windowMs } = READER_LIMITS[name];
  const now = Date.now();
  const row = await ctx.db
    .query("readerLimits")
    .withIndex("by_userId_and_bucket", (q) =>
      q.eq("userId", userId).eq("bucket", name),
    )
    .unique();
  if (!row) {
    await ctx.db.insert("readerLimits", {
      userId,
      bucket: name,
      startedAt: now,
      count: 1,
    });
    return true;
  }
  if (now - row.startedAt >= windowMs) {
    await ctx.db.patch("readerLimits", row._id, { startedAt: now, count: 1 });
    return true;
  }
  if (row.count >= max) return false;
  await ctx.db.patch("readerLimits", row._id, { count: row.count + 1 });
  return true;
}

/** Gives back one request spent in the current window, e.g. for a pass that made no model call. */
export async function refundReaderLimit(
  ctx: MutationCtx,
  userId: string,
  name: LimitBucket,
  spentAt: number,
): Promise<void> {
  const row = await ctx.db
    .query("readerLimits")
    .withIndex("by_userId_and_bucket", (q) =>
      q.eq("userId", userId).eq("bucket", name),
    )
    .unique();
  // Only the window the request was spent in; a newer window owes nothing
  if (row && row.startedAt <= spentAt && row.count > 0)
    await ctx.db.patch("readerLimits", row._id, { count: row.count - 1 });
}

export const spend = internalMutation({
  args: { userId: v.string(), bucket },
  returns: v.boolean(),
  handler: (ctx, args) => spendReaderLimit(ctx, args.userId, args.bucket),
});

/** For actions: throws the bucket's reader-facing message when it's used up. */
export async function requireReaderLimit(
  ctx: Pick<ActionCtx, "runMutation">,
  userId: string,
  name: LimitBucket,
): Promise<void> {
  const allowed: boolean = await ctx.runMutation(internal.limits.spend, {
    userId,
    bucket: name,
  });
  if (!allowed) throw new ConvexError(READER_LIMITS[name].message);
}
