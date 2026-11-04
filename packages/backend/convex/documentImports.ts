import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  query,
} from "./functions";
import { EPUB_LIMITS } from "./lib/epub/archive";
import { importLibraryActive } from "./lib/importJobs";
import { isHexSha256, storedSha256AsHex } from "./lib/uploadFingerprint";
import { READER_LIMITS, spendReaderLimit } from "./limits";

/** Past this a PDF is refused before any work: pdf.js holds it in memory. */
export const MAX_PDF_BYTES = 60 * 1024 * 1024;
const MAX_ACTIVE_IMPORTS = 2;
// The action has ten minutes; a row still reading after this lost its action
export const STALE_AFTER_MS = 15 * 60_000;
// An action killed by its time or memory limit can't clean up after itself, so
// this does it for it, a little after the limit
export const EXPIRE_AFTER_MS = 12 * 60_000;
// An upload URL is good for an hour, and so is the grant that goes with it
const GRANT_TTL_MS = 60 * 60_000;
// Files nobody imported are removed after this; one over the size limit sooner
const ORPHAN_AFTER_MS = 2 * 60 * 60_000;
const OVERSIZE_GRACE_MS = 5 * 60_000;
const SWEEP_PAGE = 100;
const MAX_FILE_NAME_CHARS = 200;

const failure = v.union(
  v.literal("protected"),
  v.literal("not_epub"),
  v.literal("scanned"),
  v.literal("too_long"),
  v.literal("unreadable"),
  v.literal("empty"),
  v.literal("too_slow"),
);

/** Storage throws for a file that is already gone, which is the state wanted. */
export async function deleteFile(
  ctx: { storage: { delete: (id: Id<"_storage">) => Promise<void> } },
  storageId: Id<"_storage">,
) {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Already deleted
  }
}

function isStale(row: Doc<"documentImports">, now: number) {
  return row.status === "reading" && now - row.updatedAt > STALE_AFTER_MS;
}

/**
 * A short-lived URL the browser POSTs the PDF to. The bytes never pass through
 * a function argument (5 MiB cap): the file goes to storage, and `start` is
 * given only its ID. The grant is bound to the file's SHA-256 and size, which
 * the browser computes before asking, so `start` can tell that the stored file
 * is the one this reader meant to upload. The hash and size are optional in
 * the validator only so a tab running the previous release gets a sentence
 * telling it to reload instead of a validation error.
 */
export const generateUploadUrl = mutation({
  args: {
    sha256: v.optional(v.string()),
    size: v.optional(v.number()),
    format: v.optional(v.union(v.literal("pdf"), v.literal("epub"))),
  },
  handler: async (ctx, args) => {
    const { sha256, size } = args;
    if (sha256 === undefined || size === undefined)
      throw new ConvexError(
        "Marginalia has been updated. Reload the page and try again.",
      );
    if (!isHexSha256(sha256) || !Number.isSafeInteger(size) || size < 0)
      throw new ConvexError("That file couldn't be checked. Try again.");
    const maxBytes =
      args.format === "epub" ? EPUB_LIMITS.archiveBytes : MAX_PDF_BYTES;
    if (size > maxBytes)
      throw new ConvexError(
        `That file is over ${maxBytes / 1024 / 1024} MB, which is more than Marginalia can read.`,
      );
    if (!(await spendReaderLimit(ctx, ctx.readerId, "pdfImport")))
      throw new ConvexError(READER_LIMITS.pdfImport.message);
    await ctx.db.insert("uploadGrants", {
      userId: ctx.readerId,
      issuedAt: Date.now(),
      sha256,
      size,
    });
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Starts reading an uploaded PDF. The storage file is checked here and claimed
 * by one import, so another reader who somehow learned the ID cannot import
 * the same file, and a refused file never stays in storage.
 */
export const start = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    format: v.optional(v.union(v.literal("pdf"), v.literal("epub"))),
  },
  handler: async (ctx, args) => {
    const refuse = (error: string): { ok: false; error: string } => ({
      ok: false,
      error,
    });
    const file = await ctx.db.system.get("_storage", args.storageId);
    if (!file)
      return {
        ok: false as const,
        error: "That upload didn't arrive. Try again.",
      };
    const claimed = await ctx.db
      .query("documentImports")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    // Someone else's claim is theirs; leave the file alone
    if (claimed)
      return {
        ok: false as const,
        error: "That upload is already being read.",
      };
    const imageOwner = await ctx.db
      .query("bookImages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    if (imageOwner) return refuse("That upload is already being read.");
    // Only a reader who was given an upload URL for this very content can
    // import a file: the grant carries the SHA-256 and size the browser
    // computed, and they must match what storage recorded. A refusal here
    // leaves the file alone: it may be another reader's.
    const now = Date.now();
    const storedHash = storedSha256AsHex(file.sha256);
    const unused = (
      await ctx.db
        .query("uploadGrants")
        .withIndex("by_userId_and_issuedAt", (q) =>
          q.eq("userId", ctx.readerId).gt("issuedAt", now - GRANT_TTL_MS),
        )
        .take(50)
    ).filter((g) => g.usedAt === undefined);
    const grant = unused.find(
      (g) =>
        storedHash !== null && g.sha256 === storedHash && g.size === file.size,
    );
    if (!grant)
      return {
        ok: false as const,
        // A grant issued before hashes existed can never match
        error: unused.some((g) => g.sha256 === undefined)
          ? "Marginalia has been updated. Reload the page and try again."
          : "That upload didn't come from you.",
      };

    // No refusal deletes the file. Until this reader's claim exists the file may
    // be someone else's in-flight upload (a matching grant only proves the
    // reader has the same bytes; docs/issues/pdf-upload-ownership.md), so
    // refused files are left for sweepUploads, which removes anything unclaimed.
    // The header is the browser's word; the action checks the file's own bytes
    if (
      file.contentType !== undefined &&
      file.contentType !==
        (args.format === "epub" ? "application/epub+zip" : "application/pdf")
    )
      return refuse(
        args.format === "epub"
          ? "Choose an EPUB file."
          : "Marginalia reads PDF files.",
      );
    const maxBytes =
      args.format === "epub" ? EPUB_LIMITS.archiveBytes : MAX_PDF_BYTES;
    if (file.size > maxBytes)
      return refuse(
        `That file is over ${maxBytes / 1024 / 1024} MB, which is more than Marginalia can read.`,
      );

    const reading = await ctx.db
      .query("documentImports")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", ctx.readerId).eq("status", "reading"),
      )
      .take(MAX_ACTIVE_IMPORTS + 1);
    if (reading.filter((r) => !isStale(r, now)).length >= MAX_ACTIVE_IMPORTS)
      return refuse("Two PDFs are already being read. Wait for one to finish.");

    const fileName =
      args.fileName
        .toWellFormed()
        .split(/[\\/]/)
        .pop()
        ?.trim()
        .slice(0, MAX_FILE_NAME_CHARS) ||
      (args.format === "epub" ? "Untitled.epub" : "Untitled.pdf");
    await ctx.db.patch("uploadGrants", grant._id, { usedAt: now });
    const importId = await ctx.db.insert("documentImports", {
      userId: ctx.readerId,
      storageId: args.storageId,
      fileName,
      format: args.format,
      status: "reading",
      step: "text",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      args.format === "epub"
        ? internal.actions.importEpub.run
        : internal.actions.importPdf.run,
      {
        importId,
      },
    );
    await ctx.scheduler.runAfter(
      EXPIRE_AFTER_MS,
      internal.documentImports.expire,
      { importId },
    );
    return { ok: true as const, importId };
  },
});

/** The reader's latest import, for the desk to show its steps or its refusal. */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("documentImports")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .first();
    if (!row) return null;
    const stale = isStale(row, Date.now());
    const article = row.articleId
      ? await ctx.db.get("articles", row.articleId)
      : null;
    return {
      _id: row._id,
      fileName: row.fileName,
      format: row.format,
      status: stale ? ("failed" as const) : row.status,
      step: row.step,
      pages: row.pages,
      units: row.units,
      articleId: row.articleId,
      title: row.title,
      firstUnitTitle: row.firstUnitTitle,
      firstUnitMinutes: row.firstUnitMinutes,
      // The whole document's length: one article, or every part of a book
      minutes:
        article?.userId === ctx.readerId
          ? article.estimatedReadMinutes
          : undefined,
      failure: stale ? ("unreadable" as const) : row.failure,
    };
  },
});

/** Clears a finished or failed import from the desk. */
export const dismiss = mutation({
  args: { importId: v.id("documentImports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("documentImports", args.importId);
    if (row?.userId !== ctx.readerId) throw new Error("Import not found");
    if (row.status === "reading" && !isStale(row, Date.now())) return;
    await ctx.db.delete("documentImports", row._id);
  },
});

// --- Internal, for actions/importPdf.ts ---

/**
 * The import row, only while the import may still write: the row exists, it is
 * the reader's and still reading, and the library is active. Otherwise the
 * reader deleted their account (or the import expired) while the action ran,
 * so the file goes and nothing may be written. Call it in the same
 * transaction as the write it guards.
 */
export async function liveImport(
  ctx: MutationCtx,
  importId: Id<"documentImports">,
): Promise<Doc<"documentImports"> | null> {
  const row = await ctx.db.get("documentImports", importId);
  if (!row) return null;
  if (row.status !== "reading") return null;
  if (!(await importLibraryActive(ctx, row.userId))) {
    await deleteFile(ctx, row.storageId);
    await ctx.db.delete("documentImports", importId);
    return null;
  }
  return row;
}

export const get = internalQuery({
  args: { importId: v.id("documentImports") },
  handler: (ctx, args) => ctx.db.get("documentImports", args.importId),
});

/** A scheduled action may be delivered twice; only one may parse this upload. */
export const claim = internalMutation({
  args: { importId: v.id("documentImports") },
  handler: async (ctx, args) => {
    const row = await liveImport(ctx, args.importId);
    if (!row || row.processingStartedAt !== undefined) return null;
    await ctx.db.patch(row._id, { processingStartedAt: Date.now() });
    // The existing expiration job owns cleanup if this action is killed.
    return row;
  },
});

export const setProgress = internalMutation({
  args: {
    importId: v.id("documentImports"),
    step: v.union(v.literal("text"), v.literal("sections"), v.literal("point")),
    pages: v.optional(v.number()),
    units: v.optional(v.number()),
  },
  handler: async (ctx, { importId, ...progress }) => {
    if (!(await liveImport(ctx, importId))) return false;
    await ctx.db.patch("documentImports", importId, {
      ...progress,
      updatedAt: Date.now(),
    });
    return true;
  },
});

/**
 * Marks an import ready and removes its upload. Called inside the mutation
 * that publishes the article or book, so the two are one commit: an import is
 * never ready without its text, and its text is never published unready.
 */
export async function markImportReady(
  ctx: MutationCtx,
  row: Doc<"documentImports">,
  ready: {
    articleId: Id<"articles">;
    title: string;
    pages?: number;
    units?: number;
    firstUnitTitle?: string;
    firstUnitMinutes?: number;
  },
) {
  await ctx.db.patch("documentImports", row._id, {
    ...ready,
    partialArticleId: undefined,
    status: "ready",
    step: "point",
    updatedAt: Date.now(),
  });
  // The PDF itself is not kept: its text is stored, and the file is the
  // reader's own to keep
  await deleteFile(ctx, row.storageId);
}

/** Records why a PDF was refused and removes its file. Nothing else is left behind. */
export const fail = internalMutation({
  args: { importId: v.id("documentImports"), failure },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("documentImports", args.importId);
    if (row?.status !== "reading") return;
    if (row.partialArticleId)
      await ctx.scheduler.runAfter(0, internal.books.discardBook, {
        userId: row.userId,
        articleId: row.partialArticleId,
        importId: row._id,
      });
    await ctx.db.patch("documentImports", args.importId, {
      status: "failed",
      failure: args.failure,
      updatedAt: Date.now(),
    });
    await deleteFile(ctx, row.storageId);
  },
});

/**
 * Scheduled at start for after the action's time limit. An import still
 * reading then lost its action, which can't clean up after itself: its file,
 * and any half-written book, are removed and the import is marked failed.
 */
export const expire = internalMutation({
  args: { importId: v.id("documentImports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("documentImports", args.importId);
    if (row?.status !== "reading") return;
    if (row.partialArticleId)
      await ctx.scheduler.runAfter(0, internal.books.discardBook, {
        userId: row.userId,
        articleId: row.partialArticleId,
        importId: row._id,
      });
    // partialArticleId stays until discardBook has removed everything
    await ctx.db.patch("documentImports", args.importId, {
      status: "failed",
      failure: "too_slow",
      updatedAt: Date.now(),
    });
    await deleteFile(ctx, row.storageId);
  },
});

/**
 * Hourly: removes uploads nobody imported. A file no import row refers to is
 * dropped after two hours, or after five minutes when it is over the size
 * limit, since it could never be imported. Walks storage a page at a time.
 */
export const sweepUploads = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ numItems: SWEEP_PAGE, cursor: args.cursor ?? null });
    for (const file of page.page) {
      const age = now - file._creationTime;
      if (age < OVERSIZE_GRACE_MS) continue;
      if (age < ORPHAN_AFTER_MS && file.size <= MAX_PDF_BYTES) continue;
      const claimed = await ctx.db
        .query("documentImports")
        .withIndex("by_storageId", (q) => q.eq("storageId", file._id))
        .first();
      if (claimed) continue;
      const image = await ctx.db
        .query("bookImages")
        .withIndex("by_storageId", (q) => q.eq("storageId", file._id))
        .first();
      if (!image) await deleteFile(ctx, file._id);
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.documentImports.sweepUploads, {
        cursor: page.continueCursor,
      });
    else {
      // Grants past their hour are of no use
      const old = await ctx.db
        .query("uploadGrants")
        .withIndex("by_userId_and_issuedAt")
        .filter((q) => q.lt(q.field("issuedAt"), now - ORPHAN_AFTER_MS))
        .take(SWEEP_PAGE);
      for (const grant of old) await ctx.db.delete("uploadGrants", grant._id);
    }
  },
});
