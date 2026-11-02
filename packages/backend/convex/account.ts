import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { revokeSessions } from "./access";
import { purgeForReader as purgeArticleImportKeys } from "./articleImportKeys";
import { purgeArticleMetadata } from "./articleMetadata";
import { internalMutation, type MutationCtx, mutation } from "./functions";
import { purgeLegacyMarkDefaults } from "./highlights";
import { DEFAULT_USER_ID } from "./lib/constants";
import { purgeCurrentReporting } from "./lib/currentReporting";
import { purgeDictionary } from "./lib/dictionaryIndex";
import { purgeDiscoveryRevision } from "./lib/discoveryRevision";
import { purgeEdgeExplanations } from "./lib/edgeExplanations";
import { purgeFeedPolls } from "./lib/feedPollLifecycle";
import { purgeFeedArticleCleanup } from "./lib/feedRemovalState";
import { purgeFeedStatus } from "./lib/feedStatus";
import { purgeFingerprintMetadata } from "./lib/fingerprintMetadata";
import { purgeFullSummaries } from "./lib/fullSummaries";
import { purgeHighlightIdentities } from "./lib/highlightIdentity";
import { purgeLegacyReporting } from "./lib/legacyReporting";
import { purgeManualAnnotations } from "./lib/manualAnnotations";
import { purgeTagAliases } from "./lib/tagAliases";
import { purgeTagVectors } from "./lib/tagVectors";
import { purgeTagVocabulary } from "./lib/tagVocabulary";
import { purgePreparedPage } from "./preparedArticles";
import { purgeReadingResumes } from "./readingResume";
import { purgeScriptureKeeps } from "./scriptureKeeps";
import { purgeStudyReader } from "./scriptureStudyCleanup";
import { purgeMetadata } from "./vaultFiles";

export const DELETE_CONFIRMATION = "DELETE";

/**
 * A reader deletes their own account: access ends now, and their library,
 * credentials and sign-in records are purged in the background.
 */
export const deleteMine = mutation({
  args: { confirmation: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.readerId === DEFAULT_USER_ID)
      throw new ConvexError("The owner's account can't be deleted here.");
    if (args.confirmation !== DELETE_CONFIRMATION)
      throw new ConvexError(`Type ${DELETE_CONFIRMATION} to confirm.`);
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", ctx.readerId))
      .unique();
    if (!reader) throw new ConvexError("Account not found.");
    await ctx.db.patch("readers", reader._id, {
      status: "disabled",
      deletingAt: reader.deletingAt ?? Date.now(),
    });
    await revokeSessions(ctx, reader.authId);
    await ctx.scheduler.runAfter(0, internal.account.purge, {
      userId: reader.libraryId,
      authId: reader.authId,
      email: reader.email,
      step: 0,
    });
    return null;
  },
});

interface Target {
  userId: string;
  authId: string;
  email?: string;
}
type Rows = { _id: Id<TableNames> }[];
// Each step deletes one bounded batch and reports how many rows it removed,
// WAIT checks again after WAIT_MS; PAGE_EMPTY advances in a fresh transaction.
type Step = (ctx: MutationCtx, target: Target) => Promise<number>;
const WAIT = -1;
const PAGE_EMPTY = -2;
const WAIT_MS = 5_000;
// How long the purge leaves a ChatGPT connection for its revocation action
const REVOKE_GRACE_MS = 2 * 60_000;

const BATCH = 64;
// Articles carry full text and an embedding, so smaller batches stay within limits
const ARTICLE_BATCH = 16;
/** Rows per step where each holds a vector, about 14 KB */
const PASSAGE_BATCH = 64;
// A valid body may approach 1 MiB. Pagination may return that first row even
// over this target; keep room for deletion/trigger reads in the same transaction.
const BODY_READ_BYTES = 512 * 1024;
const BODY_PAGE = {
  cursor: null,
  numItems: BATCH,
  maximumBytesRead: BODY_READ_BYTES,
};

function rows(
  batch: (ctx: MutationCtx, userId: string) => Promise<Rows>,
  empty = 0,
): Step {
  return async (ctx, { userId }) => {
    const found = await batch(ctx, userId);
    for (const row of found) await ctx.db.delete(row._id);
    return found.length || empty;
  };
}

function authRows(
  model: "passkey" | "twoFactor" | "account" | "session",
): Step {
  return async (ctx, { authId }) => {
    const result = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: { model, where: [{ field: "userId", value: authId }] },
        paginationOpts: { numItems: BATCH, cursor: null },
      },
    );
    return result.count;
  };
}

/** Every table that holds a library's rows, then its reader and auth records. */
const STEPS: Step[] = [
  rows((ctx, u) =>
    ctx.db
      .query("readingPageSources")
      .withIndex("by_userId_and_articleId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readingPageDays")
      .withIndex("by_userId_and_day", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // First, so a job already in flight finds its claim gone and writes nothing
  // (bookIndex.ts also refuses writes for a reader being deleted)
  rows((ctx, u) =>
    ctx.db
      .query("bookIndexUnits")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("bookIndexState")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readingActivity")
      .withIndex("by_user_started", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("paragraphDwell")
      .withIndex("by_user_article", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("feedStats")
      .withIndex("by_user_feed", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("feedOpenCounts")
      .withIndex("by_key", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("feedStatsBackfill")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("tasteProfiles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("preAnnotations")
      .withIndex("by_user_chosenAt", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("suggestionKeeps")
      .withIndex("by_user_kind_subject", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("tagMergeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("annotations")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_to", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("reflections")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows(
    async (ctx, u) =>
      (
        await ctx.db
          .query("highlights")
          .withIndex("by_userId_and_readerHighlightId", (q) =>
            q.eq("userId", u),
          )
          .paginate(BODY_PAGE)
      ).page,
    PAGE_EMPTY,
  ),
  (ctx, { userId }) => purgeLegacyMarkDefaults(ctx, userId),
  rows(
    async (ctx, u) =>
      (
        await ctx.db
          .query("userNotes")
          .withIndex("by_user", (q) => q.eq("userId", u))
          .paginate(BODY_PAGE)
      ).page,
    PAGE_EMPTY,
  ),
  rows(
    async (ctx, u) =>
      (
        await ctx.db
          .query("companionThreads")
          .withIndex("by_user", (q) => q.eq("userId", u))
          .paginate(BODY_PAGE)
      ).page,
    PAGE_EMPTY,
  ),
  async (ctx, { userId }) => {
    // Keep this step's numeric position for already-scheduled purges.
    const removed = await purgeDictionary(ctx, userId);
    if (removed) return removed;
    const lookups = (
      await ctx.db
        .query("lookups")
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .paginate(BODY_PAGE)
    ).page;
    for (const row of lookups) await ctx.db.delete(row._id);
    return lookups.length || PAGE_EMPTY;
  },
  rows((ctx, u) =>
    ctx.db
      .query("summaries")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("impressions")
      .withIndex("by_user_updated", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows(
    async (ctx, u) =>
      (
        await ctx.db
          .query("noteChunks")
          .withIndex("by_user", (q) => q.eq("userId", u))
          .paginate(BODY_PAGE)
      ).page,
    PAGE_EMPTY,
  ),
  async (ctx, { userId }) => {
    const prepared = await purgePreparedPage(ctx, userId);
    if (prepared) return prepared;
    const polls = await purgeFeedPolls(ctx, userId);
    if (polls) return polls;
    const tags = await purgeTagVocabulary(ctx, userId);
    if (tags) return tags;
    const aliases = await purgeTagAliases(ctx, userId);
    if (aliases) return aliases;
    const discovery = await purgeDiscoveryRevision(ctx, userId);
    if (discovery) return discovery;
    const vectors = await purgeTagVectors(ctx, userId);
    if (vectors) return vectors;
    const fingerprints = await purgeFingerprintMetadata(ctx, userId);
    if (fingerprints) return fingerprints;
    const resumes = await purgeReadingResumes(ctx, userId);
    if (resumes) return resumes;
    const reporting = await purgeLegacyReporting(ctx, userId);
    if (reporting) return reporting;
    const currentReporting = await purgeCurrentReporting(ctx, userId);
    // A fully drained, tiny page can share this existing metadata round. Larger
    // pages keep their own byte headroom; never schedule a redundant empty page.
    if (
      currentReporting.removed &&
      (!currentReporting.complete || currentReporting.reservedBytes > 64 * 1024)
    )
      return currentReporting.removed;
    const removed = await purgeArticleMetadata(ctx, userId);
    if (removed) return removed;
    const manual = await purgeManualAnnotations(ctx, userId);
    if (manual) return manual;
    const identities = await purgeHighlightIdentities(ctx, userId);
    if (identities) return identities;
    const summaries = await purgeFullSummaries(ctx, userId);
    if (summaries) return summaries;
    const sources = await purgeFeedStatus(ctx, userId);
    if (sources) return sources;
    const edges = await purgeEdgeExplanations(ctx, userId);
    if (edges) return edges;
    const feedArticles = await purgeFeedArticleCleanup(ctx, userId);
    if (feedArticles) return feedArticles;
    return (await purgeMetadata(ctx, userId)) || PAGE_EMPTY;
  },
  rows((ctx, u) =>
    ctx.db
      .query("marginaliaPasses")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // Cached query vectors are 1536 floats each
  rows((ctx, u) =>
    ctx.db
      .query("queryEmbeddings")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", u))
      .take(ARTICLE_BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("queryEmbeddingCounts")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // A book's units carry its text, like articles do
  rows(
    async (ctx, u) =>
      (
        await ctx.db
          .query("bookUnits")
          .withIndex("by_userId_and_articleId_and_index", (q) =>
            q.eq("userId", u),
          )
          .paginate({
            cursor: null,
            numItems: ARTICLE_BATCH,
            maximumBytesRead: BODY_READ_BYTES,
          })
      ).page,
    PAGE_EMPTY,
  ),
  rows((ctx, u) =>
    ctx.db
      .query("books")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // Passages carry 1536-number vectors, so they go a few rows at a time
  rows((ctx, u) =>
    ctx.db
      .query("bookPassages")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(PASSAGE_BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("articlePassages")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(PASSAGE_BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("articlePassageState")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("bookUnitStatus")
      .withIndex("by_userId_and_articleId_and_index", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // An import still reading owns an uploaded file, which goes with it
  async (ctx, { userId }) => {
    const imports = await ctx.db
      .query("documentImports")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(BATCH);
    for (const row of imports) {
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // Already deleted when the import finished or failed
      }
      await ctx.db.delete(row._id);
    }
    return imports.length;
  },
  rows((ctx, u) =>
    ctx.db
      .query("uploadGrants")
      .withIndex("by_userId_and_issuedAt", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  async (ctx, { userId }) => {
    // Drain aliases within the existing article step; queued numeric steps stay valid.
    const removed = await purgeArticleImportKeys(ctx, userId);
    if (removed) return removed;
    const articles = (
      await ctx.db
        .query("articles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({
          cursor: null,
          numItems: ARTICLE_BATCH,
          maximumBytesRead: BODY_READ_BYTES,
        })
    ).page;
    for (const row of articles) await ctx.db.delete(row._id);
    return articles.length || PAGE_EMPTY;
  },
  rows(
    async (ctx, u) =>
      (
        await ctx.db
          .query("feeds")
          .withIndex("by_user", (q) => q.eq("userId", u))
          .paginate(BODY_PAGE)
      ).page,
    PAGE_EMPTY,
  ),
  async (ctx, { userId }) => {
    // Keep the existing numeric counter step valid for pre-deploy purge jobs.
    const entries = await ctx.db
      .query("readableQueueEntries")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(BATCH);
    for (const entry of entries) await ctx.db.delete(entry._id);
    if (entries.length === BATCH) return entries.length;
    let removed = 0;
    for (const table of ["readingQueueStats", "readableQueueStats"] as const) {
      const stats = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH);
      for (const row of stats) await ctx.db.delete(row._id);
      removed += stats.length;
    }
    return removed;
  },
  rows((ctx, u) =>
    ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("providerCredentials")
      .withIndex("by_userId_and_provider", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readwiseCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("apiTokens")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // Revoke the ChatGPT refresh token with OpenAI first, best effort: the
  // action deletes the row, and after REVOKE_GRACE_MS the purge does anyway
  async (ctx, { userId }) => {
    const row = await ctx.db
      .query("chatgptConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!row) return 0;
    const now = Date.now();
    if (row.ciphertext && !row.revokeRequestedAt) {
      await ctx.db.patch("chatgptConnections", row._id, {
        revokeRequestedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.chatgpt.revokeForDeletion, {
        userId,
      });
      return WAIT;
    }
    if (row.revokeRequestedAt && now - row.revokeRequestedAt < REVOKE_GRACE_MS)
      return WAIT;
    await ctx.db.delete("chatgptConnections", row._id);
    return 1;
  },
  rows((ctx, u) =>
    ctx.db
      .query("articleTags")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("reannotateState")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("catchUpState")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("chatgptAuthAttempts")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readerLimits")
      .withIndex("by_userId_and_bucket", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // The invite they used and the request that led to it
  async (ctx, { authId, email }) => {
    if (!email) return 0;
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(BATCH);
    const requests = await ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(BATCH);
    for (const row of invites)
      if (row.consumedBy === authId || !row.consumedBy)
        await ctx.db.delete(row._id);
    for (const row of requests) await ctx.db.delete(row._id);
    return 0;
  },
  rows((ctx, u) =>
    ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", u))
      .take(BATCH),
  ),
  // Sweep display leases in an existing step, preserving queued numeric steps.
  async (ctx, args) => {
    const keepRows = await purgeScriptureKeeps(ctx, args.userId);
    if (keepRows) return keepRows;
    const studyRows = await purgeStudyReader(ctx, args.userId);
    if (studyRows) return studyRows;
    const leases = await ctx.db
      .query("bibleReadingSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(BATCH);
    for (const row of leases) await ctx.db.delete(row._id);
    if (leases.length) return leases.length;
    return authRows("passkey")(ctx, args);
  },
  authRows("twoFactor"),
  authRows("session"),
  authRows("account"),
  async (ctx, { authId }) => {
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "user", where: [{ field: "_id", value: authId }] },
    });
    return 0;
  },
];

/**
 * Deletes one batch, then reschedules itself until every step is empty.
 * Idempotent and resumable: re-running any step only finds what is left.
 */
export const purge = internalMutation({
  args: {
    userId: v.string(),
    authId: v.string(),
    email: v.optional(v.string()),
    step: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.userId === DEFAULT_USER_ID)
      throw new Error("The owner's library is never purged");
    const owner = await ctx.db
      .query("readerAccess")
      .withIndex("by_key", (q) => q.eq("key", "owner"))
      .unique();
    if (owner?.authId && owner.authId === args.authId)
      throw new Error("The owner's account is never purged");
    // A live reader is never purged; once their row is gone, re-running
    // only sweeps up anything left behind
    for (const reader of [
      await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", args.userId))
        .first(),
      await ctx.db
        .query("readers")
        .withIndex("by_authId", (q) => q.eq("authId", args.authId))
        .first(),
    ])
      if (
        reader &&
        (reader.authId !== args.authId ||
          reader.libraryId !== args.userId ||
          !reader.deletingAt)
      )
        throw new Error("This account isn't being deleted");
    let step = args.step;
    let removed = 0;
    while (step < STEPS.length) {
      removed = await STEPS[step](ctx, args);
      // A transaction permits one paginated query, including empty pages.
      if (removed === PAGE_EMPTY) {
        step++;
        break;
      }
      if (removed !== 0) break;
      step++;
    }
    if (step < STEPS.length)
      await ctx.scheduler.runAfter(
        removed === WAIT ? WAIT_MS : 0,
        internal.account.purge,
        {
          ...args,
          step,
        },
      );
    return null;
  },
});
