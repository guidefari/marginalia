import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { annotationType } from "./lib/annotationKinds";
import { currentReportingTables } from "./lib/currentReportingSchema";
import { discoveryEpochs } from "./lib/discoveryRevisionSchema";
import { edgeExplanationState } from "./lib/edgeExplanations";
import { feedPollTables } from "./lib/feedPollProtocol";
import { feedRemovalJob } from "./lib/feedRemovalState";
import { feedStatusTables } from "./lib/feedStatus";
import { fingerprintTables } from "./lib/fingerprintSchema";
import { fullSummaryState } from "./lib/fullSummaries";
import { highlightIdentityTables } from "./lib/highlightIdentitySchema";
import { legacyReportingTables } from "./lib/legacyReportingSchema";
import { manualAnnotationState } from "./lib/manualAnnotations";
import { marginaliaFingerprint } from "./lib/marginaliaFingerprint";
import { markColor } from "./lib/markColours";
import { noteIndexState } from "./lib/noteIndex";
import { scriptureKeepTables } from "./lib/scriptureKeepsSchema";
import {
  contextSummaryValidator,
  coverageValidator,
  evidenceValidator,
  findingValidator,
  generationValidator,
  outcomeValidator,
  runStatusValidator,
  selectionValidator,
  teachingValidator,
} from "./lib/scriptureStudy";
import {
  followUpSourceOutcomeValidator,
  studyAnswerValidator,
} from "./lib/scriptureStudyFollowUps";
import { tagAliasTables } from "./lib/tagAliasSchema";
import { tagVectorTables } from "./lib/tagVectorSchema";
import { tagVocabularyTables } from "./lib/tagVocabularySchema";

const queueCounts = {
  annotated: v.number(),
  waiting: v.number(),
  pending: v.number(),
  fits5: v.number(),
  fits10: v.number(),
  fits20: v.number(),
};

const tasteEntry = v.object({
  key: v.string(),
  affinity: v.number(),
  // Offers or articles behind the affinity
  n: v.number(),
});

export default defineSchema({
  scriptureStudyFollowUps: defineTable({
    userId: v.string(),
    runId: v.id("scriptureStudyRuns"),
    requestKey: v.string(),
    question: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    leaseUntil: v.number(),
    modelPolicyHash: v.string(),
    credentialHash: v.string(),
    modelId: v.string(),
    token: v.optional(v.string()),
    answer: v.optional(studyAnswerValidator),
    followUpPolicyHash: v.optional(v.string()),
    additionalEvidence: v.optional(v.array(evidenceValidator)),
    carriedEvidenceIds: v.optional(v.array(v.string())),
    sourceOutcomes: v.optional(v.array(followUpSourceOutcomeValidator)),
    evidenceSetHash: v.optional(v.string()),
  })
    .index("by_runId", ["runId"])
    .index("by_userId_and_requestKey", ["userId", "requestKey"])
    .index("by_userId", ["userId"]),
  ...scriptureKeepTables,
  scriptureStudyRequests: defineTable({
    userId: v.string(),
    requestKey: v.string(),
    runId: v.id("scriptureStudyRuns"),
  })
    .index("by_userId_and_requestKey", ["userId", "requestKey"])
    .index("by_runId", ["runId"])
    .index("by_userId", ["userId"]),
  scriptureStudyBudgets: defineTable({
    userId: v.string(),
    starts: v.array(v.number()),
  }).index("by_userId", ["userId"]),
  scriptureStudies: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    selection: selectionValidator,
    scopeKey: v.string(),
    sourceHash: v.string(),
    modelPolicyHash: v.string(),
    activeRunId: v.optional(v.id("scriptureStudyRuns")),
    publishedRunId: v.optional(v.id("scriptureStudyRuns")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_scopeKey", ["userId", "scopeKey"])
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId", ["userId"]),
  scriptureStudyRuns: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    studyId: v.id("scriptureStudies"),
    requestKey: v.string(),
    status: runStatusValidator,
    leaseUntil: v.number(),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
    sourceHash: v.string(),
    modelPolicyHash: v.string(),
    credentialHash: v.string(),
    version: v.string(),
    sourcePolicy: v.string(),
    claimToken: v.optional(v.string()),
    evidenceSetHash: v.optional(v.string()),
    inputKey: v.optional(v.string()),
    modelId: v.string(),
    outcome: v.optional(outcomeValidator),
    errorCode: v.optional(v.string()),
    coverage: v.optional(v.array(coverageValidator)),
    evidence: v.optional(v.array(evidenceValidator)),
    contextSummary: v.optional(contextSummaryValidator),
    teaching: v.optional(teachingValidator),
    contextHash: v.optional(v.string()),
    generation: v.optional(generationValidator),
    purgeAt: v.optional(v.number()),
  })
    .index("by_studyId", ["studyId"])
    .index("by_userId_and_requestKey", ["userId", "requestKey"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId", ["userId"])
    .index("by_purgeAt", ["purgeAt"]),
  scriptureStudyFindings: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    runId: v.id("scriptureStudyRuns"),
    order: v.number(),
    finding: findingValidator,
  })
    .index("by_runId_and_order", ["runId", "order"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_articleId", ["userId", "articleId"]),

  // Shared provider responses, never reader annotations or AI sources. Internal access only.
  bibleResourceCache: defineTable({
    key: v.string(),
    body: v.string(),
    expiresAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),
  // Only a display lease, never licensed Scripture. New opens retire older views.
  bibleReadingSessions: defineTable({
    userId: v.string(),
    token: v.string(),
  }).index("by_userId", ["userId"]),
  ...currentReportingTables,
  discoveryEpochs,
  ...legacyReportingTables,
  ...feedPollTables,
  ...feedStatusTables,
  ...fingerprintTables,
  ...highlightIdentityTables,
  ...tagVocabularyTables,
  ...tagAliasTables,
  ...tagVectorTables,
  manualAnnotationState,
  fullSummaryState,
  edgeExplanationState,
  // Exact displayed Ask paragraphs: one replaceable, <=950KB version per scope.
  preparedArticles: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.optional(v.number()),
    format: v.literal("safe-paragraphs-v1"),
    sourceHash: v.string(),
    representationHash: v.string(),
    paragraphs: v.array(v.string()),
    bytes: v.number(),
  }).index("by_userId_and_articleId_and_unitIndex", [
    "userId",
    "articleId",
    "unitIndex",
  ]),
  // Fixed-window budgets for unauthenticated endpoints: "password" (global),
  // "password:<email>" and "waitlist". Stale rows are swept hourly.
  authAttempts: defineTable({
    scope: v.string(),
    startedAt: v.number(),
    count: v.number(),
  })
    .index("by_scope", ["scope"])
    .index("by_startedAt", ["startedAt"]),
  // Per-reader fixed-window budgets, one row per reader and bucket
  readerLimits: defineTable({
    userId: v.string(),
    bucket: v.string(),
    startedAt: v.number(),
    count: v.number(),
  }).index("by_userId_and_bucket", ["userId", "bucket"]),
  // Public waitlist. Never reveals whether an email is already on it.
  accessRequests: defineTable({
    email: v.string(),
    name: v.string(),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    inviteId: v.optional(v.id("invites")),
  })
    .index("by_email", ["email"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),
  // One-time invites. Only the SHA-256 of the token is stored; the owner
  // receives the plaintext link once, when approving.
  invites: defineTable({
    tokenHash: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    requestId: v.optional(v.id("accessRequests")),
    expiresAt: v.number(),
    // Set by the sign-up hook once the token checks out; the user trigger
    // only consumes a recently reserved invite
    reservedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
    consumedBy: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_email", ["email"]),
  readerAccess: defineTable({
    key: v.literal("owner"),
    email: v.optional(v.string()),
    authId: v.optional(v.string()),
    setupHash: v.optional(v.string()),
    setupExpiresAt: v.optional(v.number()),
  }).index("by_key", ["key"]),
  // Signed-in readers other than the owner, each with their own library.
  // The owner is mapped through readerAccess and keeps the "default_user" library.
  readers: defineTable({
    authId: v.string(),
    libraryId: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    // Set when the reader deletes their account; the purge runs in batches
    deletingAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_authId", ["authId"])
    .index("by_libraryId", ["libraryId"])
    .index("by_status", ["status"]),
  feeds: defineTable({
    userId: v.string(),
    url: v.string(),
    title: v.string(),
    siteUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    lastFetchedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    // Posts published before this are skipped; set by the feed's first poll
    importAfter: v.optional(v.number()),
    // Articles of this feed in the library, kept by the mutations that insert
    // and delete them so the Sources page never reads article rows to count.
    // Unset until feeds.backfillArticleCounts has run for the feed.
    articleCount: v.optional(v.number()),
    // Set when a check starts and cleared when this feed finishes, so the page
    // can show a check in progress after a reload or a scheduled poll
    checkingSince: v.optional(v.number()),
    // Distinguishes this run's result from an older error, including repeats.
    checkRun: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_url", ["userId", "url"]),

  articles: defineTable({
    manualAnnotationRevision: v.optional(v.number()),
    feedId: v.optional(v.id("feeds")),
    userId: v.string(),
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    content: v.optional(v.string()),
    contentHtml: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    estimatedReadMinutes: v.optional(v.number()),
    bible: v.optional(
      v.object({
        reference: v.string(),
        translation: v.string(),
        copyright: v.string(),
        displayVersionId: v.optional(v.number()),
        displayVersionName: v.optional(v.string()),
      }),
    ),
    imageUrl: v.optional(v.string()),
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
    extractionRun: v.optional(v.number()),
    extractionLeaseUntil: v.optional(v.number()),
    extractionAttempts: v.optional(v.number()),
    extractionRetryAt: v.optional(v.number()),
    extractionFailure: v.optional(
      v.union(
        v.literal("invalid"),
        v.literal("transient"),
        v.literal("exhausted"),
      ),
    ),
    libraryIndex: v.optional(
      v.object({
        revision: v.number(),
        hash: v.string(),
        model: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("ready"),
          v.literal("failed"),
          v.literal("unavailable"),
        ),
        attempts: v.number(),
        run: v.number(),
        leaseUntil: v.optional(v.number()),
        retryAt: v.optional(v.number()),
      }),
    ),
    annotationStatus: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("deferred"),
    ),
    // Why a "skipped" article was skipped. "no_provider" articles are
    // re-annotated once the library saves a key (catchUp.ts); older skipped
    // rows have no reason and are re-annotated only by hand.
    skipReason: v.optional(
      v.union(
        v.literal("no_provider"),
        v.literal("bible_disabled"),
        v.literal("licensed_bible_read_only"),
      ),
    ),
    // The marginalia generation that wrote this article's notes; below
    // CURRENT_ANNOTATION_VERSION (lib/annotationGate.ts) it is re-annotated by
    // the one-off backfill (reannotateBackfill.ts). Absent on older rows.
    annotationVersion: v.optional(v.number()),
    // Retries of a failed first annotation started from the desk or reader;
    // capped so an article that always fails stops spending
    annotationRetries: v.optional(v.number()),
    // When the backfill scheduled this article; no run schedules it again
    // until the claim is released or expires (reannotateBackfill.ts)
    reannotateClaimedAt: v.optional(v.number()),
    // What the margin drew on when the import pass started; reading alongside
    // compares it with the reader's library now (rung 2f). Absent on older rows.
    marginaliaFingerprint: v.optional(marginaliaFingerprint),
    // The sorted `kind:id:version` items the import pass drew on, so the first
    // pass of a section can tell what is new since (rung 2f)
    marginaliaSources: v.optional(v.array(v.string())),
    embedding: v.optional(v.array(v.float64())),
    // When the embedding was set or cleared; the reading-alongside fingerprint reads the newest
    embeddedAt: v.optional(v.number()),
    // Set when the article came from (or was matched to) Readwise Reader
    readerDocumentId: v.optional(v.string()),
    // Set for a PDF the reader uploaded (documentImports.ts)
    uploadedFileName: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    // A book is too big for one row: its text lives in bookUnits and this row
    // keeps only the outline (rung 3b). Its own annotationStatus stays
    // "skipped", because notes are written per unit as the reader gets there.
    bookUnitCount: v.optional(v.number()),
    bookOutline: v.optional(
      v.array(
        v.object({
          title: v.string(),
          minutes: v.number(),
          chapter: v.optional(v.string()),
        }),
      ),
    ),
    finishedAt: v.optional(v.number()),
    queueCounted: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_userId_and_libraryIndex_status_and_leaseUntil", [
      "userId",
      "libraryIndex.status",
      "libraryIndex.leaseUntil",
    ])
    .index("by_userId_and_libraryIndex_status_and_retryAt", [
      "userId",
      "libraryIndex.status",
      "libraryIndex.retryAt",
    ])
    // Only unclaimed non-book rows whose backoff is due may fill a free slot.
    .index("by_extraction_queue", [
      "userId",
      "extractionStatus",
      "bookUnitCount",
      "extractionLeaseUntil",
      "extractionRetryAt",
    ])
    .index("by_catch_up_article", [
      "userId",
      "extractionStatus",
      "embeddedAt",
      "libraryIndex.status",
    ])
    .index("by_userId_and_extractionStatus_and_extractionLeaseUntil", [
      "userId",
      "extractionStatus",
      "extractionLeaseUntil",
    ])
    .index("by_user_embeddedAt", ["userId", "embeddedAt"])
    .index("by_feed", ["feedId"])
    .index("by_user_feed", ["userId", "feedId"])
    .index("by_reader_document", ["readerDocumentId"])
    .index("by_userId_and_readerDocumentId", ["userId", "readerDocumentId"])
    .index("by_user", ["userId"])
    .index("by_user_guid", ["userId", "guid"])
    .index("by_userId_and_bible_reference", ["userId", "bible.reference"])
    .index("by_user_url", ["userId", "url"])
    .index("by_extraction_status", ["userId", "extractionStatus"])
    .index("by_annotation_status", ["userId", "annotationStatus"])
    .index("by_userId_and_annotationStatus_and_skipReason", [
      "userId",
      "annotationStatus",
      "skipReason",
    ])
    // One range for everything unread and unarchived, whatever its annotation
    // status, so the Up next shelf can page it with Convex's own cursors
    .index("by_user_finishedAt", ["userId", "finishedAt"])
    .index("by_user_annotationStatus_finishedAt", [
      "userId",
      "annotationStatus",
      "finishedAt",
    ])
    // Time-window suggestions read only the articles nearest the window's length
    .index("by_userId_and_bibleTranslation_and_annotationStatus", [
      "userId",
      "bible.translation",
      "annotationStatus",
    ])
    .index("by_user_annotationStatus_finishedAt_minutes", [
      "userId",
      "annotationStatus",
      "finishedAt",
      "estimatedReadMinutes",
    ])
    // The picker's title match: the first card shows before the query is embedded
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["userId", "extractionStatus"],
    })
    // The picker's text match: the first card for a topic that names no title
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId", "extractionStatus"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  articleImportKeys: defineTable({
    userId: v.string(),
    key: v.string(),
    articleId: v.id("articles"),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_articleId", ["userId", "articleId"]),

  // Derived display/ownership surface. Never add prose, vectors or outlines.
  articleMetadata: defineTable({
    bible: v.optional(
      v.object({
        reference: v.string(),
        translation: v.string(),
        copyright: v.string(),
        displayVersionId: v.optional(v.number()),
        displayVersionName: v.optional(v.string()),
      }),
    ),
    articleId: v.id("articles"),
    userId: v.string(),
    sourceCreationTime: v.number(),
    title: v.string(),
    url: v.string(),
    guid: v.string(),
    urlDeferred: v.optional(v.boolean()),
    guidDeferred: v.optional(v.boolean()),
    author: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    feedId: v.optional(v.id("feeds")),
    publishedAt: v.optional(v.number()),
    estimatedReadMinutes: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
    annotationStatus: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("deferred"),
    ),
    annotationRetries: v.optional(v.number()),
    annotationVersion: v.optional(v.number()),
    hasContent: v.optional(v.boolean()),
    finishedAt: v.optional(v.number()),
    bookUnitCount: v.optional(v.number()),
    uploadedFileName: v.optional(v.string()),
    readerDocumentId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_articleId", ["articleId"])
    .index("by_user", ["userId", "sourceCreationTime", "articleId"])
    .index("by_user_finishedAt", [
      "userId",
      "finishedAt",
      "sourceCreationTime",
      "articleId",
    ])
    .index("by_user_annotationStatus_finishedAt", [
      "userId",
      "annotationStatus",
      "finishedAt",
      "sourceCreationTime",
      "articleId",
    ])
    .index("by_user_annotationStatus_finishedAt_minutes", [
      "userId",
      "annotationStatus",
      "finishedAt",
      "estimatedReadMinutes",
      "sourceCreationTime",
      "articleId",
    ])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["userId", "extractionStatus"],
    }),
  bookPartCards: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    unitId: v.id("bookUnits"),
    index: v.number(),
    title: v.string(),
    minutes: v.number(),
  })
    .index("by_unitId", ["unitId"])
    .index("by_userId_and_articleId_and_index", [
      "userId",
      "articleId",
      "index",
    ]),
  libraryMetadataState: defineTable({
    userId: v.string(),
    articlesReady: v.boolean(),
    phase: v.union(
      v.literal("articles"),
      v.literal("parts"),
      v.literal("saved"),
      v.literal("loved"),
      v.literal("done"),
    ),
    cursor: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),
  shelfCounts: defineTable({
    userId: v.string(),
    saved: v.number(),
    loved: v.number(),
    ready: v.boolean(),
  }).index("by_userId", ["userId"]),

  annotations: defineTable({
    articleId: v.id("articles"),
    userId: v.string(),
    type: annotationType,
    // A named fallacy, for type "fallacy" ("false dilemma")
    fallacyName: v.optional(v.string()),
    // A connection to another article in the same library, instead of a vault note
    articleRefId: v.optional(v.id("articles")),
    anchorText: v.string(),
    anchorStartOffset: v.number(),
    anchorEndOffset: v.number(),
    content: v.string(),
    noteChunkId: v.optional(v.id("noteChunks")),
    notePath: v.optional(v.string()),
    noteExcerpt: v.optional(v.string()),
    relevanceScore: v.number(),
    wasViewed: v.boolean(),
    wasDismissed: v.boolean(),
    // The reading unit the anchor offsets belong to, for a note on a book
    unitIndex: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_article_and_unitIndex", ["articleId", "unitIndex"])
    .index("by_user", ["userId"])
    // Which annotations point at a vault note, by its file so reindexing keeps them (idea graph)
    .index("by_user_note_path", ["userId", "notePath"]),

  // One row per article section that reading alongside has looked at (rung
  // 2f). The row is the claim: a pass starts only by claiming it in a mutation,
  // so two tabs or a fast scroll can't run a section twice.
  marginaliaPasses: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    sectionIndex: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    // When the running pass was claimed; it identifies that run
    claim: v.number(),
    // The claim stands until then; the running job renews it (alongside.renew)
    leaseUntil: v.optional(v.number()),
    // The library fingerprint this section was last settled against
    fingerprint: marginaliaFingerprint,
    // The fingerprint the running pass was claimed under
    pending: v.optional(marginaliaFingerprint),
    // Hash of the stored items this section's context drew on, last time
    contextHash: v.optional(v.string()),
    // Passes claimed for this section that were not refunded
    calls: v.number(),
    notesAdded: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_articleId_and_sectionIndex", [
      "userId",
      "articleId",
      "sectionIndex",
    ])
    .index("by_userId", ["userId"]),

  // A PDF on its way in: the desk shows its steps, and a failure keeps its
  // reason here so nothing else is left half-imported (documentImports.ts).
  documentImports: defineTable({
    format: v.optional(v.union(v.literal("pdf"), v.literal("epub"))),
    processingStartedAt: v.optional(v.number()),
    userId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    status: v.union(
      v.literal("reading"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    step: v.union(v.literal("text"), v.literal("sections"), v.literal("point")),
    pages: v.optional(v.number()),
    units: v.optional(v.number()),
    articleId: v.optional(v.id("articles")),
    // A book's article while it is still being written: the cleanup after a
    // timeout removes it, since the action that made it can no longer
    partialArticleId: v.optional(v.id("articles")),
    title: v.optional(v.string()),
    firstUnitTitle: v.optional(v.string()),
    firstUnitMinutes: v.optional(v.number()),
    failure: v.optional(
      v.union(
        v.literal("scanned"),
        v.literal("protected"),
        v.literal("not_epub"),
        v.literal("too_long"),
        v.literal("unreadable"),
        v.literal("empty"),
        v.literal("too_slow"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),

  // One row per upload URL a reader was given. `start` spends one, so a
  // storage file can only be imported by a reader who asked to upload.
  uploadGrants: defineTable({
    userId: v.string(),
    issuedAt: v.number(),
    usedAt: v.optional(v.number()),
    // The file this grant is for, as the browser measured it. Absent only on
    // grants issued before binding; those can't be spent.
    sha256: v.optional(v.string()),
    size: v.optional(v.number()),
  }).index("by_userId_and_issuedAt", ["userId", "issuedAt"]),

  // One row per book: where the reader is, so the desk can offer only the
  // next unit (lib/bookPicks.ts). Units counted from 0.
  books: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    unitCount: v.number(),
    // The last unit read to its end, or -1
    finishedThrough: v.number(),
    // The furthest unit the reader has got into, and how far, or -1
    furthestUnit: v.number(),
    furthestScroll: v.number(),
    // The paragraph at the top of the view there, within furthestUnit
    furthestParagraph: v.optional(v.number()),
    // Read to the end, or archived: kept here so unfinished books can be found
    // without reading their articles. The article's finishedAt is the truth;
    // every change to it moves this too (books.syncFinished).
    finished: v.optional(v.boolean()),
    lastReadAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_finished", ["userId", "finished"]),

  // A book's text, one reading unit per row (a unit is a few thousand words)
  bookUnitStatus: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    index: v.number(),
    unitId: v.id("bookUnits"),
    annotationStatus: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("deferred"),
    ),
    skipReason: v.optional(v.literal("no_provider")),
    annotationRetries: v.optional(v.number()),
  }).index("by_userId_and_articleId_and_index", [
    "userId",
    "articleId",
    "index",
  ]),

  bookUnits: defineTable({
    sourceSpans: v.optional(
      v.array(
        v.object({
          spineIndex: v.number(),
          start: v.number(),
          end: v.number(),
        }),
      ),
    ),
    userId: v.string(),
    articleId: v.id("articles"),
    index: v.number(),
    title: v.string(),
    chapter: v.optional(v.string()),
    content: v.string(),
    contentHtml: v.string(),
    wordCount: v.number(),
    estimatedReadMinutes: v.number(),
    annotationStatus: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("deferred"),
    ),
    // Why a "skipped" unit was skipped; re-started once a provider is saved
    skipReason: v.optional(v.literal("no_provider")),
    // Retries started for a failed unit, capped like an article's
    annotationRetries: v.optional(v.number()),
  }).index("by_userId_and_articleId_and_index", [
    "userId",
    "articleId",
    "index",
  ]),

  bookImages: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    storageId: v.id("_storage"),
    href: v.string(),
  })
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_storageId", ["storageId"]),

  // Where a book's indexing has got (bookIndex.ts): summaries and passages
  // share a paced queue; the book's one point waits for settled summaries.
  // One row per book; the step that owns `runId` is the only one that advances.
  bookIndexState: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    running: v.boolean(),
    runId: v.number(),
    phase: v.union(
      v.literal("summaries"),
      v.literal("point"),
      v.literal("passages"),
      v.literal("done"),
    ),
    // Legacy phase cursor, retained for queued old steps; protocol 2 rescans
    // the capped small claim rows of both lanes instead.
    cursor: v.number(),
    // Calls made for the book's one point, capped
    pointAttempts: v.number(),
    // When the call for the book's one point was scheduled; a watchdog retries
    // it if that claim is still the current one a TTL later
    pointClaimedAt: v.optional(v.number()),
    // Protocol 2 shares one paced queue between summaries and passages. Legacy
    // phase values remain valid; these fields are initialized lazily.
    protocol: v.optional(v.literal(2)),
    nextLane: v.optional(v.union(v.literal("summary"), v.literal("passages"))),
    nextBatchAt: v.optional(v.number()),
    claimFloor: v.optional(v.number()),
    // A key resume accepts already-paid completions, but not pauses reported
    // by actions that loaded the previous key.
    pauseFloor: v.optional(v.number()),
    lastClaim: v.optional(v.number()),
    overviewDone: v.optional(v.boolean()),
    // One-shot allowance for an overview action already running old code at
    // protocol adoption. New claims must never create this allowance.
    legacyPoint: v.optional(v.object({ runId: v.number(), claim: v.number() })),
    summaryBlocked: v.optional(
      v.union(v.literal("no_key"), v.literal("unusable_key")),
    ),
    passagesBlocked: v.optional(
      v.union(v.literal("no_key"), v.literal("unusable_key")),
    ),
    // Why a run stopped for want of a usable key; saving a key resumes it
    pausedReason: v.optional(
      v.union(v.literal("no_key"), v.literal("unusable_key")),
    ),
    // Pauses for an unusable key. Refunded tries never reset it.
    failures: v.optional(v.number()),
    // Units left failed when the run ended that a later start may try again
    recoverable: v.optional(v.number()),
    queued: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId", ["userId"]),

  // One row per unit and stage. The row is the claim: a unit's job is
  // scheduled only by writing it "pending" in a mutation, so a restart or a
  // second run never schedules it twice. Small on purpose: a bookUnits row
  // can be about 400 KB, and the outline reads every unit's summary.
  bookIndexUnits: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    stage: v.union(v.literal("summary"), v.literal("passages")),
    unitIndex: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    // When the job was scheduled; a pending row older than the TTL has lost its job
    claimedAt: v.number(),
    attempts: v.number(),
    // The unit's one-to-two-sentence summary (stage "summary")
    summary: v.optional(v.string()),
    // How many passages were written (stage "passages")
    passageCount: v.optional(v.number()),
    model: v.optional(v.string()),
    // Failures other than a refused key, over the life of the book. A run's
    // `attempts` start again each run; these don't, and cap the retrying.
    failures: v.optional(v.number()),
  })
    .index("by_userId_and_articleId_and_stage_and_unitIndex", [
      "userId",
      "articleId",
      "stage",
      "unitIndex",
    ])
    .index("by_userId", ["userId"]),

  // About 300-token passages of a book, each under its heading, embedded for
  // Ask about this book. Searched by book; every read also checks the reader.
  bookPassages: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    passageIndex: v.number(),
    heading: v.string(),
    text: v.string(),
    embedding: v.array(v.float64()),
  })
    .index("by_userId_and_articleId_and_unitIndex", [
      "userId",
      "articleId",
      "unitIndex",
    ])
    .index("by_userId", ["userId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["articleId"],
    }),

  // About 300-token runs of an ordinary article's paragraphs, embedded the
  // first time the reader asks about the article (D-DES-054). The text isn't
  // stored: the paragraph range says where it is, and `contentHash` says the
  // article hasn't changed since. Exact ranking reads bounded server-query
  // pages, never an eventually consistent approximate vector index.
  articlePassages: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    contentHash: v.string(),
    model: v.string(),
    startParagraph: v.number(),
    endParagraph: v.number(),
    // Where the passage starts and stops inside those paragraphs, for a long
    // paragraph split into several
    fromOffset: v.number(),
    toOffset: v.number(),
    embedding: v.array(v.float64()),
    generation: v.optional(v.number()),
  })
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId_and_articleId_and_generation", [
      "userId",
      "articleId",
      "generation",
    ])
    .index("by_userId", ["userId"]),

  articlePassageState: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    contentHash: v.string(),
    model: v.string(),
    generation: v.number(),
    count: v.number(),
    total: v.number(),
  })
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId", ["userId"]),

  // The reader's topic vocabulary (blueprint 02, Tags). A candidate stays
  // hidden until it recurs on enough articles.
  tags: defineTable({
    userId: v.string(),
    name: v.string(),
    // Normalised name (lib/tagMatching.ts), unique per reader
    key: v.string(),
    description: v.optional(v.string()),
    // Embedding of name plus description; absent until embedded
    embedding: v.optional(v.array(v.float64())),
    status: v.union(v.literal("candidate"), v.literal("active")),
    // Articles carrying the tag
    count: v.number(),
    // Other normalised names that mean this tag
    aliases: v.array(v.string()),
    // For a candidate in the near-match band: the tag it almost was
    nearestTagId: v.optional(v.id("tags")),
    createdAt: v.number(),
  })
    .index("by_user_key", ["userId", "key"])
    .index("by_user_status", ["userId", "status"]),

  articleTags: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    tagId: v.id("tags"),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_tag", ["tagId"])
    .index("by_article_tag", ["articleId", "tagId"])
    .index("by_user", ["userId"]),

  // Links the reader made between two ideas (rung 5d). `from` and `to` are
  // node keys, "<kind>:<id>" with kind note, highlight, answer or vault.
  // Direction records which idea was written from which; a link reads the
  // same either way, so a pair has at most one row.
  ideaLinks: defineTable({
    userId: v.string(),
    from: v.string(),
    to: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_from_to", ["userId", "from", "to"])
    .index("by_user_to", ["userId", "to"]),

  // Generated one-sentence reasons for edges that only embeddings found. Kept
  // apart from ideaLinks because those edges have no link row. `fingerprint`
  // hashes both ideas' text, so editing either one regenerates the reason.
  edgeReasons: defineTable({
    userId: v.string(),
    // The two node keys, sorted and joined (lib/ideaGraph.ts#pairKey)
    pair: v.string(),
    fingerprint: v.string(),
    input: v.optional(v.string()),
    reason: v.string(),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_user_pair", ["userId", "pair"]),

  // Progress of the one-off re-annotation (reannotateBackfill.ts)
  reannotateState: defineTable({
    userId: v.string(),
    running: v.boolean(),
    runId: v.number(),
    // _creationTime of the last article checked
    cursor: v.optional(v.number()),
    // Which statuses the scan has reached: annotated articles first, then
    // ones whose first annotation failed
    phase: v.optional(v.literal("failed")),
    scanSource: v.optional(v.union(v.literal("metadata"), v.literal("legacy"))),
    scanAfter: v.optional(v.number()),
    scanCursor: v.optional(v.string()),
    scanDone: v.optional(v.boolean()),
    pendingIds: v.optional(v.array(v.id("articles"))),
    batchStartedAt: v.optional(v.number()),
    batchQueued: v.optional(v.number()),
    nextBatchAt: v.optional(v.number()),
    lastScheduledAt: v.optional(v.number()),
    queued: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  feedArticleCleanup: defineTable(feedRemovalJob)
    .index("by_articleId", ["articleId"])
    .index("by_feedId_phase", ["feedId", "phase"])
    .index("by_userId", ["userId"]),

  reflections: defineTable({
    articleId: v.id("articles"),
    userId: v.string(),
    strongestPoint: v.string(),
    weakestAssumption: v.string(),
    credibleCounterview: v.string(),
    questionForYou: v.string(),
    userResponse: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_responded", ["userId", "respondedAt"]),

  sessions: defineTable({
    userId: v.string(),
    clientKey: v.optional(v.string()),
    requestedMinutes: v.number(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    articleId: v.optional(v.id("articles")),
    readingStatus: v.union(
      v.literal("selecting"),
      v.literal("reading"),
      v.literal("reflecting"),
      v.literal("completed"),
      v.literal("abandoned"),
    ),
    scrollPercentage: v.optional(v.number()),
    annotationsViewed: v.optional(v.number()),
    timeSpentMs: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_userId_and_clientKey", ["userId", "clientKey"])
    .index("by_user_recent", ["userId", "startedAt"]),

  articleInteractions: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    sessionId: v.optional(v.id("sessions")),
    visitId: v.optional(v.string()),
    action: v.union(
      v.literal("presented"),
      v.literal("opened"),
      v.literal("finished"),
      v.literal("abandoned"),
      v.literal("skipped"),
      v.literal("saved"),
    ),
    scrollPercentage: v.optional(v.number()),
    timeSpentMs: v.optional(v.number()),
    // Engagement metrics
    activeTimeMs: v.optional(v.number()),
    maxScrollPercent: v.optional(v.number()),
    annotationsOpened: v.optional(v.array(v.string())),
    totalScrollEvents: v.optional(v.number()),
    tabHiddenCount: v.optional(v.number()),
    // Set once the per-feed counters have decided this interaction, whether
    // they counted it or not, so no path counts it a second time.
    feedCounted: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_article", ["articleId"])
    .index("by_user_article", ["userId", "articleId"])
    .index("by_user_article_action", ["userId", "articleId", "action"])
    // Whether another row of a visit's finish has already been decided
    .index("by_user_article_action_visit_counted", [
      "userId",
      "articleId",
      "action",
      "visitId",
      "feedCounted",
    ])
    .index("by_user_action_created", ["userId", "action", "createdAt"]),

  // Cumulative checkpoints per page visit and local day make retries idempotent.
  readingActivity: defineTable({
    userId: v.string(),
    visitId: v.string(),
    day: v.string(),
    articleId: v.id("articles"),
    sessionId: v.optional(v.id("sessions")),
    startedAt: v.number(),
    updatedAt: v.number(),
    activeTimeMs: v.number(),
    visibleTimeMs: v.number(),
    timeSpentMs: v.number(),
    maxScrollPercent: v.number(),
    // The paragraph at the top of the view at maxScrollPercent, so Continue
    // returns to it rather than to a proportion of the text
    paragraphIndex: v.optional(v.number()),
    annotationsOpened: v.array(v.string()),
    finishedAt: v.optional(v.number()),
    // Copied from the article when the visit is recorded, so statistics can
    // tell a short read from a long one without reading the article
    estimatedReadMinutes: v.optional(v.number()),
    pageCredit: v.optional(
      v.object({
        sourceId: v.string(),
        coverage: v.string(),
        visualTimeMs: v.number(),
        timeZone: v.string(),
        goalWords: v.union(v.number(), v.null()),
      }),
    ),
  })
    .index("by_user_visit_day", ["userId", "visitId", "day"])
    .index("by_user_started", ["userId", "startedAt"])
    .index("by_user_article", ["userId", "articleId"]),

  readingPageSources: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    sourceKey: v.string(),
    method: v.literal("visible-cells-v1"),
    wordCount: v.number(),
    paragraphWords: v.array(v.number()),
    coverage: v.string(),
    creditedWords: v.number(),
  }).index("by_userId_and_articleId", ["userId", "articleId"]),
  readingPageDays: defineTable({
    userId: v.string(),
    day: v.string(),
    timeZone: v.string(),
    creditedWords: v.number(),
    goalWords: v.union(v.number(), v.null()),
    achievedAt: v.optional(v.number()),
    presentedAt: v.optional(v.number()),
  }).index("by_userId_and_day", ["userId", "day"]),

  // One small cumulative Continue row per reader/article, not an event window.
  readingResumes: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    eligible: v.boolean(),
    lastActivityAt: v.number(),
    maxScrollPercent: v.number(),
    paragraphIndex: v.optional(v.number()),
    placeUpdatedAt: v.number(),
    placeKey: v.string(),
    hasCheckpoint: v.boolean(),
  })
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId_and_eligible_and_lastActivityAt_and_articleId", [
      "userId",
      "eligible",
      "lastActivityAt",
      "articleId",
    ]),
  readingResumeState: defineTable({
    userId: v.string(),
    phase: v.union(
      v.literal("interactions"),
      v.literal("checkpoints"),
      v.literal("done"),
    ),
    cursor: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),

  // Milliseconds each paragraph held the reader's attention in one visit and
  // local day, keyed by the paragraph's displayed number. A sibling of
  // readingActivity, not a field on it: that table is scanned on every
  // checkpoint and by statistics, and up to 300 entries would bloat each row.
  paragraphDwell: defineTable({
    userId: v.string(),
    visitId: v.string(),
    day: v.string(),
    articleId: v.id("articles"),
    dwell: v.record(v.string(), v.number()),
    updatedAt: v.number(),
  })
    .index("by_user_visit_day", ["userId", "visitId", "day"])
    .index("by_user_article", ["userId", "articleId"]),

  // Per-feed offer outcomes, counted where articleInteractions are inserted.
  feedStats: defineTable({
    userId: v.string(),
    feedId: v.id("feeds"),
    offered: v.number(),
    opened: v.number(),
    finished: v.number(),
    skipped: v.number(),
    updatedAt: v.number(),
  }).index("by_user_feed", ["userId", "feedId"]),

  // Opens counted so far per reader, article and session (none is its own
  // key): desk opens (no visitId) and reader-page visit opens. The feed gets
  // max(desk, visit), because a desk open and its visit are one open.
  feedOpenCounts: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    sessionId: v.optional(v.id("sessions")),
    desk: v.number(),
    visit: v.number(),
  }).index("by_key", ["userId", "articleId", "sessionId"]),

  // Progress of rebuilding a reader's feedStats under the current counting
  // rules. A row without the current version is rebuilt from the start.
  feedStatsBackfill: defineTable({
    userId: v.string(),
    version: v.optional(v.number()),
    phase: v.optional(
      v.union(
        v.literal("stats"),
        v.literal("counts"),
        v.literal("markers"),
        v.literal("count"),
      ),
    ),
    cursor: v.optional(v.string()),
    // Creation time of the last interaction the counting pass has reached
    seen: v.optional(v.number()),
    // A live interaction arrived behind the counting pass
    dirty: v.optional(v.boolean()),
    // When the next step was last scheduled, to notice one that was lost
    scheduledAt: v.optional(v.number()),
    // Only the step holding this token may run, so a chain cannot fork
    stepToken: v.optional(v.string()),
    stepJobId: v.optional(v.id("_scheduled_functions")),
    ready: v.boolean(),
  }).index("by_user", ["userId"]),

  readingQueueStats: defineTable({
    userId: v.string(),
    annotated: v.number(),
    waiting: v.number(),
    pending: v.number(),
    fits5: v.number(),
    fits10: v.number(),
    fits20: v.number(),
    ready: v.boolean(),
    cursor: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  readableQueueStats: defineTable({
    userId: v.string(),
    ...queueCounts,
    generation: v.number(),
    ready: v.boolean(),
    cursor: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  readableQueueEntries: defineTable({
    articleId: v.id("articles"),
    userId: v.string(),
    generation: v.number(),
    ...queueCounts,
  })
    .index("by_articleId", ["articleId"])
    .index("by_userId", ["userId"]),

  readwiseSyncState: defineTable({
    userId: v.string(),
    active: v.boolean(),
    backfilledAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAfter: v.optional(v.string()),
    phase: v.number(),
    pageCursor: v.optional(v.string()),
    pageProcessedIds: v.array(v.string()),
    token: v.optional(v.string()),
    leaseUntil: v.number(),
    nextRunAt: v.number(),
    scanned: v.number(),
    imported: v.number(),
    linked: v.number(),
    skipped: v.number(),
    highlights: v.number(),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  vaultFiles: defineTable({
    userId: v.string(),
    filePath: v.string(),
    fileHash: v.union(v.string(), v.null()),
  }).index("by_user_file", ["userId", "filePath"]),

  vaultManifestBackfills: defineTable({
    userId: v.string(),
    afterPath: v.optional(v.string()),
    complete: v.boolean(),
  }).index("by_user", ["userId"]),

  noteChunks: defineTable({
    userId: v.string(),
    filePath: v.string(),
    fileName: v.string(),
    chunkIndex: v.number(),
    content: v.string(),
    tags: v.optional(v.array(v.string())),
    embedding: v.array(v.float64()),
    fileHash: v.string(),
    indexedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_file", ["userId", "filePath"])
    .index("by_file_hash", ["userId", "fileHash"])
    // The newest chunk, for the reading-alongside fingerprint
    .index("by_user_indexedAt", ["userId", "indexedAt"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  savedArticles: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    savedAt: v.number(),
    shelfCounted: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_user_article", ["userId", "articleId"]),

  userNotes: defineTable({
    licensedQuote: v.optional(v.boolean()),
    userId: v.string(),
    articleId: v.id("articles"),
    // The text the user highlighted when creating the note
    selectedText: v.string(),
    selectedStartOffset: v.optional(v.number()),
    selectedEndOffset: v.optional(v.number()),
    // The part of a book the passage is in; the offsets are within it
    unitIndex: v.optional(v.number()),
    // Set when the note is a reflection on an auto annotation (e.g. answering a Question).
    // Not a hard reference: re-annotating deletes annotations but keeps the note.
    annotationId: v.optional(v.id("annotations")),
    // What the note responds to (e.g. the Question it answers), kept so the
    // note still makes sense after re-annotating deletes the annotation
    prompt: v.optional(v.string()),
    // Rich-text HTML produced by Tiptap; sanitize before rendering.
    content: v.string(),
    // Plain text version for search/embedding
    contentPlain: v.string(),
    // Embedding for future annotation matching
    embedding: v.optional(v.array(v.float64())),
    // When the embedding was set or cleared; the reading-alongside fingerprint reads the newest
    embeddedAt: v.optional(v.number()),
    noteIndex: v.optional(noteIndexState),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_embeddedAt", ["userId", "embeddedAt"])
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_article", ["articleId"])
    .index("by_articleId_and_annotationId", ["articleId", "annotationId"])
    .index("by_article_and_unitIndex", ["articleId", "unitIndex"])
    .index("by_user_recent", ["userId", "updatedAt"])
    .searchIndex("search_content", {
      searchField: "contentPlain",
      filterFields: ["userId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  lovedArticles: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    lovedAt: v.number(),
    shelfCounted: v.optional(v.boolean()),
    reviewIndex: v.number(),
    nextReviewAt: v.number(),
    lastReviewedAt: v.optional(v.number()),
    reviewCount: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_article", ["userId", "articleId"])
    .index("by_user_next_review", ["userId", "nextReviewAt"]),

  // Ask / Explain / Simplify / Define conversations about a highlighted passage.
  // `turns` is bounded: the companion endpoint accepts at most 30 history turns.
  companionThreads: defineTable({
    summaryDefinition: v.optional(v.boolean()),
    userId: v.string(),
    articleId: v.id("articles"),
    mode: v.union(
      v.literal("explain"),
      v.literal("simplify"),
      v.literal("define"),
      v.literal("ask"),
      v.literal("article"),
    ),
    selection: v.string(),
    question: v.optional(v.string()),
    paragraphIndex: v.optional(v.number()),
    // Which match of `selection` in its paragraph was selected, from 0
    occurrence: v.optional(v.number()),
    // The last paragraph a multi-paragraph selection crosses
    paragraphEnd: v.optional(v.number()),
    // The part of a book the passage is in; paragraphIndex counts within it
    unitIndex: v.optional(v.number()),
    turns: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    model: v.optional(v.string()),
    // Passage + question + first answer, so future marginalia can recall it
    embedding: v.optional(v.array(v.float64())),
    // When the embedding was set or cleared; the reading-alongside fingerprint reads the newest
    embeddedAt: v.optional(v.number()),
    // Set when the reader chose Keep. Rows written before answers became
    // temporary have none: they were saved automatically.
    keptAt: v.optional(v.number()),
    // The id the reader client gave the answer: a retried Keep finds its row by this
    answerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_articleId_and_unitIndex_and_answerId", [
      "userId",
      "articleId",
      "unitIndex",
      "answerId",
    ])
    .index("by_user_embeddedAt", ["userId", "embeddedAt"])
    .index("by_article", ["articleId"])
    .index("by_article_and_unitIndex", ["articleId", "unitIndex"])
    .index("by_user", ["userId"])
    .index("by_user_kept", ["userId", "keptAt"])
    // The latest edit, for the reading-alongside fingerprint
    .index("by_user_updatedAt", ["userId", "updatedAt"])
    .searchIndex("search_selection", {
      searchField: "selection",
      filterFields: ["userId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // Every Define the reader completed, kept or not: the raw material of the
  // personal dictionary. `sense` is the one line of Marginalia's text kept
  // without Keep, because it is the reader's own dictionary entry.
  lookups: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    word: v.string(),
    // Lower-cased `word` without surrounding punctuation, for finding repeats
    wordKey: v.string(),
    sentence: v.string(),
    unitIndex: v.optional(v.number()),
    paragraphIndex: v.optional(v.number()),
    // Which match of the word in its paragraph was looked up
    occurrence: v.optional(v.number()),
    sense: v.string(),
    // Copied from the article when the lookup is recorded, so the dictionary
    // lists titles without reading articles
    articleTitle: v.optional(v.string()),
    // Set when the article is deleted: the entry stays, its link goes
    articleGone: v.optional(v.boolean()),
    dictionaryHeadwordId: v.optional(v.id("dictionaryHeadwords")),
    // String ID tie-break preserves the dictionary's createdAt/id ordering.
    dictionarySenseOrder: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_occurrence", [
      "userId",
      "articleId",
      "unitIndex",
      "wordKey",
      "paragraphIndex",
      "occurrence",
      "sentence",
    ])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_word", ["userId", "wordKey"])
    .index("by_user_word_created_order", [
      "userId",
      "wordKey",
      "createdAt",
      "dictionarySenseOrder",
    ])
    .index("by_user_article", ["userId", "articleId"]),

  dictionaryHeadwords: defineTable({
    userId: v.string(),
    wordKey: v.string(),
    orderKey: v.string(),
    letter: v.string(),
    firstSeen: v.number(),
    firstLookupId: v.id("lookups"),
    occurrences: v.number(),
    preview: v.string(),
  })
    .index("by_user_word", ["userId", "wordKey"])
    .index("by_user_order", ["userId", "orderKey"])
    .index("by_user_letter_order", ["userId", "letter", "orderKey"])
    .index("by_user_firstSeen", ["userId", "firstSeen"]),

  // Bounded folded sense chunks, not article/note bodies. Ordinary Defines
  // need one row; overlap preserves contains matches across legacy chunk edges.
  dictionarySearch: defineTable({
    userId: v.string(),
    headwordId: v.id("dictionaryHeadwords"),
    lookupId: v.id("lookups"),
    generation: v.number(),
    scanKey: v.string(),
    foldedWord: v.string(),
    letter: v.string(),
    text: v.string(),
  })
    .index("by_user_scan", ["userId", "scanKey"])
    .index("by_user_letter_scan", ["userId", "letter", "scanKey"])
    .index("by_lookup", ["lookupId"]),

  dictionaryOccurrences: defineTable({
    userId: v.string(),
    lookupId: v.id("lookups"),
    headwordId: v.id("dictionaryHeadwords"),
    generation: v.number(),
    senseHash: v.string(),
  })
    .index("by_lookup", ["lookupId"])
    .index("by_user", ["userId"]),

  dictionaryState: defineTable({
    userId: v.string(),
    total: v.number(),
    complete: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }).index("by_user", ["userId"]),

  // Canonical baseline for marks made before explicit colours were stored.
  // Version 1 freezes the first real browser preference, once per reader/tool.
  // Continuations must find this exact row; purging it fences queued work.
  legacyMarkDefaults: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    color: markColor,
    version: v.literal(1),
    status: v.union(v.literal("running"), v.literal("done")),
    cursor: v.union(v.string(), v.null()),
    scheduledId: v.optional(v.id("_scheduled_functions")),
  }).index("by_userId_and_kind", ["userId", "kind"]),

  // Highlighter and pen marks, re-anchored by text when the article renders.
  // A mark keeps the colour it was made in; rows without one follow the reader's current setting.
  highlights: defineTable({
    licensedQuote: v.optional(v.boolean()),
    userId: v.string(),
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    color: v.optional(markColor),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
    // The part of a book the mark is in; paragraphIndex counts within it
    unitIndex: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    // When the embedding was set or cleared; the reading-alongside fingerprint reads the newest
    embeddedAt: v.optional(v.number()),
    // Readwise Reader sync: where the mark came from, and its Reader id
    source: v.optional(v.union(v.literal("marginalia"), v.literal("reader"))),
    readerHighlightId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_embeddedAt", ["userId", "embeddedAt"])
    .index("by_article", ["articleId"])
    .index("by_article_and_unitIndex", ["articleId", "unitIndex"])
    .index("by_userId_and_articleId", ["userId", "articleId"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_userId", ["userId"])
    .index("by_reader_highlight", ["readerHighlightId"])
    .index("by_userId_and_kind_and_color", ["userId", "kind", "color"])
    .index("by_userId_and_readerHighlightId", ["userId", "readerHighlightId"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["userId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // On-demand article summary: the gist, key claims and a section map.
  // Paragraph numbers are 1-based and match the reader's ¶ labels.
  summaries: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    gist: v.string(),
    // Idea map: the article's ideas and how they build towards its point
    thesis: v.optional(v.string()),
    ideas: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          detail: v.string(),
          role: v.union(
            v.literal("premise"),
            v.literal("evidence"),
            v.literal("claim"),
            v.literal("counterpoint"),
            v.literal("conclusion"),
          ),
          paragraphs: v.array(v.number()),
        }),
      ),
    ),
    links: v.optional(
      v.array(
        v.object({
          from: v.string(),
          to: v.string(),
          relation: v.union(
            v.literal("supports"),
            v.literal("leads_to"),
            v.literal("contrasts"),
            v.literal("illustrates"),
          ),
        }),
      ),
    ),
    flow: v.optional(v.string()),
    // Older summaries (before the idea map) stored these instead
    claims: v.optional(
      v.array(v.object({ text: v.string(), paragraphs: v.array(v.number()) })),
    ),
    sections: v.optional(
      v.array(
        v.object({ title: v.string(), start: v.number(), end: v.number() }),
      ),
    ),
    model: v.string(),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"]),

  // How an article landed with the reader: a 1–5 rating, quick tags and a
  // line on what stayed with them. Embedded so the library can recall it.
  impressions: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    rating: v.optional(v.number()),
    tags: v.array(v.string()),
    note: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_userId", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // A reader's own AI provider keys, one per provider, sealed with AES-GCM
  // (lib/providerKeys.ts). Only provider actions decrypt them.
  providerCredentials: defineTable({
    userId: v.string(),
    provider: v.union(
      v.literal("openrouter"),
      v.literal("openai"),
      v.literal("anthropic"),
    ),
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    validatedAt: v.number(),
  }).index("by_userId_and_provider", ["userId", "provider"]),

  // A reader's own Readwise access token, sealed like provider keys but kept
  // apart so it never appears among AI providers or model lists.
  readwiseCredentials: defineTable({
    userId: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    validatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // A reader's ChatGPT plan, connected with Sign in with ChatGPT. Off unless
  // the deployment enables it (lib/providers.ts isChatGPTEnabled). The sealed
  // JSON holds the access, refresh and ID tokens; nothing returns it.
  chatgptConnections: defineTable({
    userId: v.string(),
    subject: v.string(),
    email: v.optional(v.string()),
    clientId: v.string(),
    // Absent once the tokens are cleared (reconnect needed)
    ciphertext: v.optional(v.string()),
    iv: v.optional(v.string()),
    scopes: v.array(v.string()),
    planEnabled: v.boolean(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("connected"),
      v.literal("reconnect"),
      v.literal("plan_disabled"),
    ),
    // Why plan usage stopped, for the account page
    message: v.optional(v.string()),
    models: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
    modelsAt: v.optional(v.number()),
    // Refresh tokens rotate: only the holder of the lease may spend one.
    // `version` changes with every token write.
    refreshLease: v.optional(v.object({ id: v.string(), until: v.number() })),
    // Set by the account purge while it revokes the refresh token with OpenAI
    revokeRequestedAt: v.optional(v.number()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Pending Sign in with ChatGPT attempts, consumed once by the callback.
  chatgptAuthAttempts: defineTable({
    userId: v.string(),
    stateHash: v.string(),
    nonce: v.string(),
    // The PKCE verifier, sealed to this reader
    verifierCiphertext: v.string(),
    verifierIv: v.string(),
    expiresAt: v.number(),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_userId", ["userId"]),

  // One row per library: the paced catch-up that re-runs work skipped for
  // lack of a key (catchUp.ts). Only the step carrying `runId` may advance it.
  catchUpState: defineTable({
    userId: v.string(),
    running: v.boolean(),
    runId: v.number(),
    // Whether this run could embed when it started; a new embedding key restarts the scan
    embed: v.boolean(),
    phase: v.number(),
    // _creationTime of the last row checked in the current phase
    cursor: v.optional(v.number()),
    articlesQueued: v.number(),
    itemsQueued: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  // One row per user. Model IDs are validated against the reader's available
  // models in lib/providers.ts; older rows hold bare OpenRouter IDs.
  userSettings: defineTable({
    pageTimeZone: v.optional(v.string()),
    pagesTrackedFrom: v.optional(v.string()),
    pageGoalVisible: v.optional(v.boolean()),
    pageGoalWords: v.optional(v.union(v.number(), v.null())),
    pendingPageGoalWords: v.optional(v.union(v.number(), v.null())),
    pendingPageGoalDay: v.optional(v.string()),
    pageGoalEverEnabled: v.optional(v.boolean()),
    manualAnnotationModelRevision: v.optional(v.number()),
    userId: v.string(),
    annotationModel: v.optional(v.string()),
    quickModel: v.optional(v.string()),
    deepModel: v.optional(v.string()),
    // A speechVoices.ts catalog id; one that left the catalog reads as the default
    speechVoice: v.optional(v.string()),
    bibleEnabled: v.optional(v.boolean()),
    bibleTranslation: v.optional(v.string()),
    readingScope: v.optional(
      v.union(v.literal("articles"), v.literal("mixed"), v.literal("bible")),
    ),
    // Readwise Reader sync: documents updated after this were not yet imported
    readwiseSyncedAt: v.optional(v.number()),
    readwiseCheckedAt: v.optional(v.number()),
    readwiseError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Personal API tokens other apps use to send articles in and read highlights
  // back. Only the SHA-256 of a token is stored; the reader sees it once.
  apiTokens: defineTable({
    userId: v.string(),
    name: v.string(),
    hash: v.string(),
    last4: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_userId", ["userId"]),

  // Embeddings of topic-search queries, so a repeated search skips the
  // embedding call. Keyed by the normalised query; a row for another model,
  // or older than 30 days, is a miss (lib/queryEmbeddingCache.ts).
  queryEmbeddings: defineTable({
    userId: v.string(),
    key: v.string(),
    embedding: v.array(v.float64()),
    model: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),

  // How many queryEmbeddings rows a reader holds. Convex can't count rows
  // without reading them, and the cap is checked on every insert.
  queryEmbeddingCounts: defineTable({
    userId: v.string(),
    count: v.number(),
  }).index("by_userId", ["userId"]),

  // What a reader tends to read (rung 5c, D-DES-057): one small row of
  // explainable affinities, each in -1..1, capped per list. Recomputed daily
  // and after a finish (taste.ts). Keys are feed IDs, normalised author names
  // and tag IDs.
  tasteProfiles: defineTable({
    userId: v.string(),
    feeds: v.array(tasteEntry),
    authors: v.array(tasteEntry),
    tags: v.array(tasteEntry),
    // Articles whose outcomes fed this profile, so a thin profile can be told apart
    evidence: v.number(),
    computedAt: v.number(),
    // A refresh scheduled by a finish, so a run of finishes queues one
    refreshQueuedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // Deferred articles the daily job chose to annotate ahead of time, and a
  // control sample it passed over, so "pre-annotated articles are opened more
  // often than a random sample" can be measured (preAnnotate.ts).
  preAnnotations: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    group: v.union(v.literal("chosen"), v.literal("control")),
    // The taste term when chosen, and the signal behind it; absent for controls
    score: v.optional(v.number()),
    because: v.optional(
      v.union(v.literal("author"), v.literal("feed"), v.literal("tag")),
    ),
    chosenAt: v.number(),
  })
    .index("by_user_chosenAt", ["userId", "chosenAt"])
    .index("by_user_article", ["userId", "articleId"]),

  // A suggestion the reader declined. A feed's "Keep" lapses at `until`; a tag
  // pair's "Keep both" has no end.
  suggestionKeeps: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("feed"), v.literal("tagPair")),
    // The feed's ID, or the two tag IDs sorted and joined with "|"
    subject: v.string(),
    until: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user_kind_subject", ["userId", "kind", "subject"]),

  // Two active tags that look like one topic. Never acted on until the reader
  // accepts: `into` keeps its name, `from` becomes an alias of it.
  tagMergeSuggestions: defineTable({
    userId: v.string(),
    into: v.id("tags"),
    from: v.id("tags"),
    similarity: v.number(),
    strength: v.union(v.literal("strong"), v.literal("suggested")),
    // Set while the reader's accepted merge is moving links in batches
    merging: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
