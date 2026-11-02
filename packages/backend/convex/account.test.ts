/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import authSchema from "./betterAuth/schema";
import { sealTokens } from "./lib/chatgptTokens";
import { syncDwellReporting, syncVisitReporting } from "./lib/currentReporting";
import { indexDictionaryLookup } from "./lib/dictionaryIndex";
import { syncFeedStatus } from "./lib/feedStatus";
import {
  highlightArticleIdentityTrigger,
  highlightIdentityTrigger,
} from "./lib/highlightIdentity";
import {
  syncNoteReporting,
  syncReflectionReporting,
} from "./lib/legacyReporting";
import { metadataTriggers } from "./lib/metadataTriggers";
import { syncTagAliases } from "./lib/tagAliases";
import { syncTagVectors } from "./lib/tagVectors";
import { syncTagVocabulary } from "./lib/tagVocabulary";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const embedding = Array.from({ length: 1536 }, () => 0.25);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

/** One row in every table that holds a library's data. */
async function seedLibrary(ctx: MutationCtx, userId: string, copies = 1) {
  const now = Date.now();
  let lastArticle: Id<"articles"> | undefined;
  for (let i = 0; i < copies; i++) {
    const feedId = await ctx.db.insert("feeds", {
      userId,
      url: `https://${userId}.example/feed/${i}`,
      title: "Feed",
      isActive: true,
      createdAt: now,
    });
    const feed = await ctx.db.get(feedId);
    if (!feed) throw new Error("Missing seeded feed");
    await syncFeedStatus(ctx, null, feed);
    if (i === 0)
      await ctx.db.insert("feedPollRuns", {
        userId,
        run: 1,
        active: false,
        scanned: 0,
        exhausted: true,
        deadline: 0,
      });
    await ctx.db.insert("feedPollStates", {
      userId,
      feedId,
      url: `https://${userId}.example/feed/${i}`,
      run: 1,
      generation: 1,
      attempts: 1,
      nextBatch: 0,
      started: false,
    });
    const articleId = await ctx.db.insert("articles", {
      feedId,
      userId,
      guid: `${userId}-${i}`,
      url: `https://${userId}.example/${i}`,
      title: "Article",
      contentHtml: "<p>Text</p>",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      embedding,
      createdAt: now,
    });
    lastArticle = articleId;
    await ctx.db.insert("readingPageSources", {
      userId,
      articleId,
      sourceKey: "fixture",
      method: "visible-cells-v1",
      wordCount: 8,
      paragraphWords: [8],
      coverage: "1",
      creditedWords: 8,
    });
    await ctx.db.insert("readingPageDays", {
      userId,
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      timeZone: "UTC",
      creditedWords: 8,
      goalWords: 3000,
    });
    await ctx.db.insert("manualAnnotationState", {
      userId,
      articleId,
      run: 1,
      input: "fixture",
      status: "complete",
      attempts: 1,
      leaseUntil: 0,
      published: true,
    });
    await ctx.db.insert("fullSummaryState", {
      userId,
      articleId,
      run: 1,
      input: "fixture",
      source: "fixture",
      status: "failed",
      attempts: 1,
      leaseUntil: 0,
    });
    await ctx.db.insert("articleImportKeys", {
      userId,
      articleId,
      key: String(i).padStart(64, "0"),
    });
    const annotationId = await ctx.db.insert("annotations", {
      articleId,
      userId,
      type: "context",
      anchorText: "Text",
      anchorStartOffset: 0,
      anchorEndOffset: 4,
      content: "Note",
      relevanceScore: 0.5,
      wasViewed: false,
      wasDismissed: false,
      createdAt: now,
    });
    await ctx.db.insert("reflections", {
      articleId,
      userId,
      strongestPoint: "s",
      weakestAssumption: "w",
      credibleCounterview: "c",
      questionForYou: "q",
      createdAt: now,
    });
    const sessionId = await ctx.db.insert("sessions", {
      userId,
      requestedMinutes: 10,
      startedAt: now,
      articleId,
      readingStatus: "reading",
    });
    await ctx.db.insert("articleInteractions", {
      userId,
      articleId,
      sessionId,
      action: "opened",
      createdAt: now,
    });
    await ctx.db.insert("readingActivity", {
      userId,
      visitId: `visit-${i}`,
      day: "2026-10-12",
      articleId,
      startedAt: now,
      updatedAt: now,
      activeTimeMs: 1,
      visibleTimeMs: 1,
      timeSpentMs: 1,
      maxScrollPercent: 1,
      annotationsOpened: [],
    });
    await ctx.db.insert("paragraphDwell", {
      userId,
      visitId: `visit-${i}`,
      day: "2026-10-12",
      articleId,
      dwell: { "1": 2000 },
      updatedAt: now,
    });
    await ctx.db.insert("feedStats", {
      userId,
      feedId,
      offered: 1,
      opened: 1,
      finished: 0,
      skipped: 0,
      updatedAt: now,
    });
    await ctx.db.insert("feedOpenCounts", {
      userId,
      articleId,
      desk: 1,
      visit: 0,
    });
    await ctx.db.insert("feedStatsBackfill", {
      userId: `${userId}`,
      ready: i === 0,
    });
    // A book's rows: its text, and what indexing wrote about it
    if (i === 0) {
      await ctx.db.insert("legacyMarkDefaults", {
        userId,
        kind: "highlight",
        color: "yellow",
        version: 1,
        status: "running",
        cursor: null,
      });
      await ctx.db.insert("books", {
        userId,
        articleId,
        unitCount: 1,
        finishedThrough: -1,
        furthestUnit: -1,
        furthestScroll: 0,
        createdAt: now,
      });
      const unitId = await ctx.db.insert("bookUnits", {
        userId,
        articleId,
        index: 0,
        title: "Part one",
        content: "Text",
        contentHtml: "<p>Text</p>",
        wordCount: 1,
        estimatedReadMinutes: 1,
        annotationStatus: "deferred",
      });
      await ctx.db.insert("bookUnitStatus", {
        userId,
        articleId,
        index: 0,
        unitId,
        annotationStatus: "deferred",
      });
      await ctx.db.insert("bookIndexState", {
        userId,
        articleId,
        running: false,
        runId: 1,
        phase: "done",
        cursor: 1,
        pointAttempts: 1,
        queued: 2,
        startedAt: now,
        updatedAt: now,
      });
      for (const stage of ["summary", "passages"] as const)
        await ctx.db.insert("bookIndexUnits", {
          userId,
          articleId,
          stage,
          unitIndex: 0,
          status: "done",
          claimedAt: now,
          attempts: 1,
        });
      await ctx.db.insert("bookPassages", {
        userId,
        articleId,
        unitIndex: 0,
        passageIndex: 0,
        heading: "Part one",
        text: "Text",
        embedding,
      });
    }
    await ctx.db.insert("articlePassages", {
      userId,
      articleId,
      contentHash: "fixture",
      model: "fixture",
      startParagraph: 0,
      endParagraph: 0,
      fromOffset: 0,
      toOffset: 0,
      embedding,
    });
    await ctx.db.insert("articlePassageState", {
      userId,
      articleId,
      contentHash: "fixture",
      model: "fixture",
      generation: 1,
      count: 1,
      total: 1,
    });
    await ctx.db.insert("noteChunks", {
      userId,
      filePath: `notes/${i}.md`,
      fileName: `${i}.md`,
      chunkIndex: 0,
      content: "Vault note",
      embedding,
      fileHash: `hash-${i}`,
      indexedAt: now,
    });
    await ctx.db.insert("vaultFiles", {
      userId,
      filePath: `notes/${i}.md`,
      fileHash: `hash-${i}`,
    });
    if (i === 0)
      await ctx.db.insert("vaultManifestBackfills", { userId, complete: true });
    await ctx.db.insert("savedArticles", { userId, articleId, savedAt: now });
    await ctx.db.insert("marginaliaPasses", {
      userId,
      articleId,
      sectionIndex: 1,
      status: "done",
      claim: now,
      fingerprint: {
        notesMax: 0,
        threadsMax: 0,
        highlightsMax: 0,
        highlightsCount: 0,
        vaultIndexedMax: 0,
        passAt: now,
      },
      contextHash: "fixture",
      calls: 1,
      notesAdded: 1,
      updatedAt: now,
    });
    await ctx.db.insert("userNotes", {
      userId,
      articleId,
      annotationId,
      selectedText: "Text",
      content: "<p>Mine</p>",
      contentPlain: "Mine",
      embedding,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("lovedArticles", {
      userId,
      articleId,
      lovedAt: now,
      reviewIndex: 0,
      nextReviewAt: now,
      reviewCount: 0,
    });
    await ctx.db.insert("companionThreads", {
      userId,
      articleId,
      mode: "ask",
      selection: "Text",
      turns: [{ role: "user", content: "Why?" }],
      embedding,
      createdAt: now,
      updatedAt: now,
    });
    const lookupId = await ctx.db.insert("lookups", {
      userId,
      articleId,
      word: "text",
      wordKey: "text",
      sentence: "Text.",
      sense: "Written words.",
      createdAt: now,
    });
    if (i < 5)
      await ctx.db.insert("preparedArticles", {
        userId,
        articleId,
        format: "safe-paragraphs-v1",
        sourceHash: "a".repeat(64),
        representationHash: "b".repeat(64),
        paragraphs: ["Derived private prose"],
        bytes: 25,
      });
    if (i === 0) {
      const lookup = await ctx.db.get("lookups", lookupId);
      if (!lookup) throw new Error("Missing seeded lookup");
      await indexDictionaryLookup(ctx, lookup);
    }
    const highlightId = await ctx.db.insert("highlights", {
      userId,
      articleId,
      kind: "highlight",
      text: "Text",
      embedding,
      createdAt: now,
    });
    await ctx.db.insert("highlightIdentities", {
      userId,
      articleId,
      highlightId,
      textHash:
        "71988c4d8e0803ba4519f0b2864c1331c14a1890bf8694e251379177bfedb5c3",
    });
    await ctx.db.insert("highlightIdentityState", {
      userId,
      articleId,
      ready: true,
      cursor: null,
    });
    await ctx.db.insert("summaries", {
      userId,
      articleId,
      gist: "Gist",
      model: "fixture",
      createdAt: now,
    });
    await ctx.db.insert("ideaLinks", {
      userId,
      from: "note:a",
      to: "note:b",
      createdAt: now,
    });
    await ctx.db.insert("edgeReasons", {
      userId,
      pair: "note:a|note:b",
      fingerprint: "f",
      reason: "Both are about focus.",
      model: "fixture",
      createdAt: now,
    });
    await ctx.db.insert("edgeExplanationState", {
      userId,
      pair: `fixture-${i}`,
      a: "note:a",
      b: "note:b",
      aArticleId: articleId,
      input: "fixture",
      routing: "fixture",
      run: 1,
      status: "failed",
      attempts: 1,
      leaseUntil: 0,
    });
    await ctx.db.insert("impressions", {
      userId,
      articleId,
      tags: [],
      embedding,
      createdAt: now,
      updatedAt: now,
    });
  }
  // Rung 5c: taste, ahead-of-time choices, kept suggestions and tag merges
  await ctx.db.insert("tasteProfiles", {
    userId,
    feeds: [],
    authors: [{ key: "a writer", affinity: 0.4, n: 3 }],
    tags: [],
    evidence: 1,
    computedAt: now,
  });
  if (lastArticle)
    await ctx.db.insert("preAnnotations", {
      userId,
      articleId: lastArticle,
      group: "chosen",
      score: 0.5,
      because: "author",
      chosenAt: now,
    });
  await ctx.db.insert("suggestionKeeps", {
    userId,
    kind: "feed",
    subject: "feed",
    until: now,
    createdAt: now,
  });
  const keep = await ctx.db.insert("tags", {
    userId,
    name: "llm",
    key: "llm",
    status: "active",
    count: 1,
    aliases: ["retained-alias"],
    createdAt: now,
  });
  const drop = await ctx.db.insert("tags", {
    userId,
    name: "llms",
    key: "llms",
    status: "active",
    count: 0,
    aliases: [],
    createdAt: now,
  });
  for (const id of [keep, drop]) {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Missing seeded tag");
    await syncTagVocabulary(ctx, null, row);
    await syncTagAliases(ctx, null, row);
    await syncTagVectors(ctx, null, row);
  }
  await ctx.db.insert("tagMergeSuggestions", {
    userId,
    into: keep,
    from: drop,
    similarity: 0.95,
    strength: "strong",
    createdAt: now,
  });
  await ctx.db.insert("readingQueueStats", {
    userId,
    annotated: 1,
    waiting: 1,
    pending: 0,
    fits5: 0,
    fits10: 0,
    fits20: 0,
    ready: true,
  });
  const readableCounts = {
    annotated: 1,
    waiting: 1,
    pending: 0,
    fits5: 0,
    fits10: 0,
    fits20: 0,
  };
  await ctx.db.insert("readableQueueStats", {
    userId,
    ...readableCounts,
    generation: 1,
    ready: true,
  });
  if (lastArticle)
    await ctx.db.insert("readableQueueEntries", {
      userId,
      articleId: lastArticle,
      ...readableCounts,
      generation: 1,
    });
  await ctx.db.insert("readwiseSyncState", {
    userId,
    active: false,
    startedAt: now,
    phase: 4,
    pageProcessedIds: [],
    leaseUntil: 0,
    nextRunAt: 0,
    scanned: 0,
    imported: 0,
    linked: 0,
    skipped: 0,
    highlights: 0,
    updatedAt: now,
  });
  await ctx.db.insert("userSettings", { userId, updatedAt: now });
  await ctx.db.insert("readwiseCredentials", {
    userId,
    ciphertext: "sealed",
    iv: "iv",
    last4: "1234",
    createdAt: now,
    updatedAt: now,
    validatedAt: now,
  });
  await ctx.db.insert("readerLimits", {
    userId,
    bucket: "ai",
    startedAt: now,
    count: 1,
  });
  await ctx.db.insert("apiTokens", {
    userId,
    name: "Fixture app",
    hash: `fixture-hash-${userId}`,
    last4: "abcd",
    createdAt: now,
  });
  await ctx.db.insert("catchUpState", {
    userId,
    running: false,
    runId: 1,
    embed: true,
    phase: 6,
    articlesQueued: 0,
    itemsQueued: 0,
    startedAt: now,
    updatedAt: now,
  });
  // A legacy/raw source removal can leave an orphan claim. This row proves the
  // account metadata hook runs, rather than passing via article-delete triggers.
  const orphan = await ctx.db.insert("articles", {
    userId,
    guid: "orphan",
    url: "https://example.com/orphan",
    title: "Orphan",
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: now,
  });
  await ctx.db.delete(orphan);
  await ctx.db.insert("discoveryEpochs", { userId, shard: 0, epoch: 1 });
  const orphanVisit = await ctx.db.insert("readingActivity", {
    userId,
    articleId: orphan,
    visitId: "orphan-report",
    day: "fixture-day",
    startedAt: now,
    updatedAt: now,
    activeTimeMs: 0,
    visibleTimeMs: 0,
    timeSpentMs: 0,
    maxScrollPercent: 0,
    annotationsOpened: [],
  });
  const visit = await ctx.db.get(orphanVisit);
  if (!visit) throw new Error("Missing orphan visit");
  await syncVisitReporting(ctx, null, visit);
  await ctx.db.delete(orphanVisit);
  const orphanDwell = await ctx.db.insert("paragraphDwell", {
    userId,
    articleId: orphan,
    visitId: "orphan-report",
    day: "fixture-day",
    updatedAt: now,
    dwell: { paragraph: 1000 },
  });
  const dwell = await ctx.db.get(orphanDwell);
  if (!dwell) throw new Error("Missing orphan dwell");
  await syncDwellReporting(ctx, null, dwell);
  await ctx.db.delete(orphanDwell);
  for (const kind of ["visits", "dwell"] as const)
    await ctx.db.insert("currentReportingState", {
      userId,
      kind,
      ready: true,
      backfilled: true,
      cursor: null,
    });
  const orphanNote = await ctx.db.insert("userNotes", {
    userId,
    articleId: orphan,
    selectedText: "Orphan report fixture",
    content: "",
    contentPlain: "Retained reporting fixture",
    createdAt: now,
    updatedAt: now,
  });
  const note = await ctx.db.get(orphanNote);
  if (!note) throw new Error("Missing orphan note");
  await syncNoteReporting(ctx, null, note);
  await ctx.db.delete(orphanNote);
  const orphanReflection = await ctx.db.insert("reflections", {
    userId,
    articleId: orphan,
    strongestPoint: "",
    weakestAssumption: "",
    credibleCounterview: "",
    questionForYou: "",
    userResponse: "",
    respondedAt: now,
    createdAt: now,
  });
  const reflection = await ctx.db.get(orphanReflection);
  if (!reflection) throw new Error("Missing orphan reflection");
  await syncReflectionReporting(ctx, null, reflection);
  await ctx.db.delete(orphanReflection);
  for (const kind of ["notes", "reflections"] as const)
    await ctx.db.insert("legacyReportingState", {
      userId,
      kind,
      ready: true,
      backfilled: true,
      cursor: null,
      overflow: 0,
    });
  await ctx.db.insert("edgeExplanationState", {
    userId,
    pair: "fixture-orphan",
    a: "note:orphan-a",
    b: "note:orphan-b",
    aArticleId: orphan,
    input: "fixture-orphan",
    routing: "fixture-orphan",
    run: 1,
    status: "running",
    attempts: 1,
    leaseUntil: Date.now() + 1_200_000,
  });
  await ctx.db.insert("fullSummaryState", {
    userId,
    articleId: orphan,
    run: 1,
    input: "fixture-orphan",
    source: "fixture-orphan",
    status: "failed",
    attempts: 1,
    leaseUntil: 0,
  });
  await ctx.db.insert("highlightIdentityState", {
    userId,
    articleId: orphan,
    ready: false,
    cursor: null,
  });
  await ctx.db.insert("manualAnnotationState", {
    userId,
    articleId: orphan,
    run: 1,
    input: "fixture-orphan",
    status: "failed",
    attempts: 1,
    leaseUntil: 0,
    published: false,
  });
}

/** Every app and auth row that still mentions this ID anywhere. */
async function rowsMentioning(t: Fixture["t"], id: string) {
  const found: string[] = [];
  const mentions = (row: Record<string, unknown>) =>
    Object.entries(row).some(([, value]) => value === id);
  for (const table of Object.keys(
    schema.tables,
  ) as (keyof typeof schema.tables)[]) {
    const rows = await t.run((ctx) => ctx.db.query(table).take(2000));
    for (const row of rows)
      if (mentions(row as Record<string, unknown>)) found.push(table);
  }
  for (const model of Object.keys(authSchema.tables)) {
    const result = await t.query(components.betterAuth.adapter.findMany, {
      model: model as "user",
      paginationOpts: { numItems: 500, cursor: null },
    });
    for (const row of result.page)
      if (mentions(row as Record<string, unknown>)) found.push(`auth:${model}`);
  }
  return found;
}

async function counts(t: Fixture["t"]) {
  const out: Record<string, number> = {};
  for (const table of Object.keys(
    schema.tables,
  ) as (keyof typeof schema.tables)[])
    out[table] = (await t.run((ctx) => ctx.db.query(table).take(2000))).filter(
      (row) => (row as { userId?: string }).userId === OWNER,
    ).length;
  return out;
}

describe("account deletion", () => {
  it("removes every trace of the reader in batches and leaves the owner untouched", async () => {
    vi.useFakeTimers();
    expect(metadataTriggers.registered.highlights).toContain(
      highlightIdentityTrigger,
    );
    expect(metadataTriggers.registered.articles).toContain(
      highlightArticleIdentityTrigger,
    );
    const fixture = await secondReaderTest(modules);
    const { t, reader, owner, readerLibraryId } = fixture;
    await t.run(async (ctx) => {
      await seedLibrary(ctx, readerLibraryId, 40);
      await seedLibrary(ctx, OWNER, 2);
      const keepId = await ctx.db.insert("scriptureKeeps", {
        userId: readerLibraryId,
        referenceKey: "PSA.23",
        reference: "Psalms 23",
        estimatedReadMinutes: 1,
        createdAt: Date.now(),
      });
      await ctx.db.insert("scriptureKeepOrigins", {
        userId: readerLibraryId,
        keepId,
        originKey: "account-purge-fixture",
        sourceReference: "John 1",
        reason: "account purge canary",
        createdAt: Date.now(),
      });
      // Cached query vectors are per reader and go with the account
      for (const userId of [readerLibraryId, OWNER]) {
        await ctx.db.insert("queryEmbeddings", {
          userId,
          key: "rust async",
          embedding: Array.from({ length: 1536 }, () => 0),
          model: "openai/text-embedding-3-small",
          createdAt: Date.now(),
        });
        await ctx.db.insert("queryEmbeddingCounts", { userId, count: 1 });
      }
      await ctx.db.patch((await ctx.db.query("readers").first())!._id, {
        email: "reader@example.com",
      });
      const requestId = await ctx.db.insert("accessRequests", {
        email: "reader@example.com",
        name: "Reader",
        status: "approved",
        createdAt: Date.now(),
      });
      await ctx.db.insert("invites", {
        tokenHash: "c".repeat(64),
        email: "reader@example.com",
        requestId,
        expiresAt: Date.now(),
        consumedAt: Date.now(),
        consumedBy: readerLibraryId,
        createdAt: Date.now(),
      });
    });
    await saveTestCredential(
      t,
      readerLibraryId,
      "openai",
      "sk-reader-openai-0000000001",
    );
    await saveTestCredential(t, OWNER, "openai", "sk-owner-openai-00000000002");
    for (const model of ["account", "passkey", "twoFactor"] as const) {
      const data = {
        account: {
          accountId: readerLibraryId,
          providerId: "credential",
          userId: readerLibraryId,
          password: "hashed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        passkey: {
          userId: readerLibraryId,
          publicKey: "pk",
          credentialID: "cred",
          counter: 0,
          deviceType: "singleDevice",
          backedUp: false,
          createdAt: Date.now(),
        },
        twoFactor: {
          userId: readerLibraryId,
          secret: "s",
          backupCodes: "b",
        },
      }[model];
      await t.mutation(components.betterAuth.adapter.create, {
        input: { model, data } as never,
      });
    }
    for (const userId of [readerLibraryId, OWNER]) {
      let complete = false;
      for (let i = 0; i < 100 && !complete; i++) {
        complete = (
          await t.mutation(internal.articleMetadata.backfill, { userId })
        ).complete;
      }
      expect(complete).toBe(true);
      complete = false;
      for (let i = 0; i < 100 && !complete; i++) {
        complete = (
          await t.mutation(internal.fingerprintMetadata.backfill, { userId })
        ).complete;
      }
      expect(complete).toBe(true);
      complete = false;
      for (let i = 0; i < 100 && !complete; i++) {
        complete = (
          await t.mutation(internal.readingResume.backfill, { userId })
        ).complete;
      }
      expect(complete).toBe(true);
    }
    const ownerBefore = await counts(t);
    const highlightState = await t.run((ctx) =>
      ctx.db
        .query("highlightIdentityState")
        .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
        .first(),
    );
    if (!highlightState) throw new Error("Missing seeded highlight readiness");
    const legacyJob = await t.run((ctx) =>
      ctx.db
        .query("legacyMarkDefaults")
        .withIndex("by_userId_and_kind", (q) =>
          q.eq("userId", readerLibraryId).eq("kind", "highlight"),
        )
        .unique(),
    );
    expect(legacyJob).not.toBeNull();
    expect((await rowsMentioning(t, readerLibraryId)).length).toBeGreaterThan(
      20,
    );

    await expect(
      reader.mutation(api.account.deleteMine, { confirmation: "delete" }),
    ).rejects.toThrow("Type DELETE");
    await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    // Access ends before the purge runs
    await expect(reader.query(api.home.overview, {})).rejects.toThrow(
      "Sign in",
    );
    expect(await reader.query(api.auth.currentReader, {})).toBeNull();

    // The paged purge can exceed finishAllScheduledFunctions' 100 rounds.
    // Advance time between completed jobs, retaining a bounded completion check.
    await runScheduled(t, { maxSteps: 300 });
    const purgeJobs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").take(1000)).filter(
        (job) => job.name === "account:purge",
      ),
    );
    expect(purgeJobs.every((job) => job.state.kind === "success")).toBe(true);
    process.stdout.write(
      `reader-purge-completed ${JSON.stringify({ jobs: purgeJobs.length })}\n`,
    );
    expect(await rowsMentioning(t, readerLibraryId)).toEqual([]);
    expect(
      await t.run(async (ctx) =>
        Promise.all([
          ctx.db
            .query("scriptureKeeps")
            .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
            .take(1),
          ctx.db
            .query("scriptureKeepOrigins")
            .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
            .take(1),
        ]),
      ),
    ).toEqual([[], []]);
    // Both new and pre-versioned queued pages are harmless after account purge.
    if (!legacyJob) throw new Error("Missing seeded colour job");
    await t.mutation(internal.highlights.stampLegacyPage, {
      jobId: legacyJob._id,
      cursor: null,
    });
    await t.mutation(internal.highlights.stampUncolouredPage, {
      userId: readerLibraryId,
      kind: "highlight",
      color: "blue",
      cursor: "old-page",
    });
    expect(
      await t.mutation(internal.dictionary.backfillPage, {
        userId: readerLibraryId,
      }),
    ).toMatchObject({ inactive: true, processed: 0 });
    expect(
      await t.mutation(internal.articleMetadata.backfill, {
        userId: readerLibraryId,
      }),
    ).toMatchObject({ inactive: true, complete: false });
    expect(
      await t.mutation(internal.fingerprintMetadata.backfill, {
        userId: readerLibraryId,
      }),
    ).toMatchObject({ retained: false, complete: false });
    expect(
      await t.mutation(internal.readingResume.backfill, {
        userId: readerLibraryId,
      }),
    ).toMatchObject({ inactive: true, complete: false });
    expect(await rowsMentioning(t, readerLibraryId)).toEqual([]);
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId: readerLibraryId,
        articleId: highlightState.articleId,
      }),
    ).toEqual({ ready: false, unavailable: true });
    await expect(
      t.mutation(internal.summaries.claimFull, {
        userId: readerLibraryId,
        articleId: highlightState.articleId,
        title: "Late summary",
        paragraphs: ["Deleted library"],
      }),
    ).rejects.toThrow("Article not found");
    await expect(
      t.mutation(internal.ideaEdgeReasons.claim, {
        userId: readerLibraryId,
        a: "note:orphan-a",
        b: "note:orphan-b",
      }),
    ).rejects.toThrow("Those ideas aren't in your notes");
    expect(
      await t.mutation(internal.tags.migrateAliases, {
        userId: readerLibraryId,
      }),
    ).toEqual({ done: true, migrated: 0 });
    expect(
      await t.mutation(internal.tags.verifyAndActivateAliases, {
        userId: readerLibraryId,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.tags.migrateVectors, {
        userId: readerLibraryId,
      }),
    ).toEqual({ done: true, migrated: 0 });
    expect(
      await t.mutation(internal.tags.verifyAndActivateVectors, {
        userId: readerLibraryId,
      }),
    ).toBe(false);
    for (const kind of ["notes", "reflections"] as const) {
      expect(
        await t.mutation(internal.legacyReportingMetadata.migrate, {
          userId: readerLibraryId,
          kind,
        }),
      ).toEqual({ done: false, migrated: 0, retained: false });
      expect(
        await t.mutation(internal.legacyReportingMetadata.verifyAndActivate, {
          userId: readerLibraryId,
          kind,
        }),
      ).toBe(false);
    }
    for (const kind of ["visits", "dwell"] as const) {
      expect(
        await t.mutation(internal.currentReportingMetadata.migrate, {
          userId: readerLibraryId,
          kind,
        }),
      ).toEqual({ done: false, migrated: 0, retained: false });
      expect(
        await t.mutation(internal.currentReportingMetadata.verifyAndActivate, {
          userId: readerLibraryId,
          kind,
        }),
      ).toBe(false);
    }
    expect(await rowsMentioning(t, readerLibraryId)).toEqual([]);
    expect(await counts(t)).toEqual(ownerBefore);
    expect(await owner.query(api.feeds.list, {})).toHaveLength(2);
    const purges = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").take(500)).filter(
        (job) => job.name.includes("purge"),
      ),
    );
    // 40 articles at 16 per batch, among other tables, needs many batches
    expect(purges.length).toBeGreaterThan(10);
    expect(purges.every((job) => job.state.kind === "success")).toBe(true);

    // Idempotent: running it again finds nothing and fails nothing
    await t.mutation(internal.account.purge, {
      userId: readerLibraryId,
      authId: readerLibraryId,
      step: 0,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rowsMentioning(t, readerLibraryId)).toEqual([]);
  });

  it("refuses to delete the owner or a reader who didn't ask", async () => {
    const { t, owner, readerLibraryId } = await secondReaderTest(modules);
    await t.run((ctx) => seedLibrary(ctx, OWNER));
    await expect(
      owner.mutation(api.account.deleteMine, { confirmation: "DELETE" }),
    ).rejects.toThrow("owner's account");
    await expect(
      t.mutation(internal.account.purge, {
        userId: OWNER,
        authId: "anything",
        step: 0,
      }),
    ).rejects.toThrow("never purged");
    const ownerAuth = await t.run(
      async (ctx) => (await ctx.db.query("readerAccess").first())?.authId,
    );
    await expect(
      t.mutation(internal.account.purge, {
        userId: "someone",
        authId: String(ownerAuth),
        step: 0,
      }),
    ).rejects.toThrow("never purged");
    await expect(
      t.mutation(internal.account.purge, {
        userId: readerLibraryId,
        authId: readerLibraryId,
        step: 0,
      }),
    ).rejects.toThrow("isn't being deleted");
    expect(await owner.query(api.feeds.list, {})).toHaveLength(1);
    expect(await owner.query(api.auth.currentReader, {})).toMatchObject({
      isOwner: true,
    });
  });
});

describe("account deletion and ChatGPT", () => {
  const REVOKE_URL = "https://auth.openai.com/api/accounts/oauth/revoke";
  const CLIENT_ID = "app_chatgpt_client_fixture";
  const REFRESH = "chatgpt-refresh-token-fixture-0009";

  async function connectReader(t: Fixture["t"], userId: string) {
    vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    const sealed = await sealTokens(
      {
        access_token: "chatgpt-access-token-fixture-0009",
        refresh_token: REFRESH,
        id_token: "id-token-fixture",
      },
      userId,
    );
    await t.run((ctx) =>
      ctx.db.insert("chatgptConnections", {
        userId,
        subject: "chatgpt-subject",
        clientId: CLIENT_ID,
        ...sealed,
        scopes: [],
        planEnabled: true,
        expiresAt: Date.now() + 3_600_000,
        status: "connected",
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }

  function mockRevoke(respond: () => Response | Promise<Response>) {
    const calls: { url: string; body: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: Object.fromEntries(new URLSearchParams(String(init?.body))),
        });
        return respond();
      },
    );
    return calls;
  }

  it("revokes the refresh token once, even with ChatGPT since turned off", async () => {
    vi.useFakeTimers();
    vi.stubEnv("CHATGPT_PLAN_ENABLED", "");
    vi.stubEnv("CHATGPT_CLIENT_ID", "");
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await connectReader(t, readerLibraryId);
    const calls = mockRevoke(() => new Response(null, { status: 200 }));

    await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    await runScheduled(t);

    expect(calls).toEqual([
      {
        url: REVOKE_URL,
        body: {
          token: REFRESH,
          token_type_hint: "refresh_token",
          client_id: CLIENT_ID,
        },
      },
    ]);
    expect(await rowsMentioning(t, readerLibraryId)).toEqual([]);
  });

  it("finishes deleting when revocation fails", async () => {
    vi.useFakeTimers();
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await connectReader(t, readerLibraryId);
    const calls = mockRevoke(() => {
      throw new Error("network down");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    await runScheduled(t);

    expect(calls).toHaveLength(1);
    expect(await rowsMentioning(t, readerLibraryId)).toEqual([]);
    // Nothing logged carries the token
    expect(JSON.stringify(errors.mock.calls)).not.toContain(REFRESH);
    errors.mockRestore();
  });
});
