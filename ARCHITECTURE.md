# Architecture

Follow a reading action through the web client, Convex data and external services. The system has three workspace packages and one shared dependency:

| Package | Owns | Entry points |
| --- | --- | --- |
| `apps/web` | Next.js App Router UI, reading interactions, browser preferences | `src/app`, `src/components`, `src/lib` |
| `@planetaryescape/reader` (dependency, not a workspace package) | Article rendering, paragraph numbering, quote highlights, the reader settings model and theme CSS | Pinned as a git tag in `apps/web/package.json` |
| `packages/backend` | Convex schema, queries/mutations/actions, AI, ingestion and sync | `convex/schema.ts`, `convex/http.ts`, `convex/crons.ts` |
| `packages/vault-indexer` | Optional local Markdown chunking, embedding and index upload | `src/index.ts` |

Inspect these entry points rather than treating generated Convex bindings as handwritten application code.

## Reading and ingestion

```text
RSS polling / pasted URL / Readwise document / API (another app)
  → article extraction or supplied HTML
  → article storage + optional embedding
  → scheduled annotations
  → live Convex query → article reader
```

RSS polls every 30 minutes; Reader sync runs every 15 minutes when configured. Pasted URLs, Reader HTML and articles sent through the [API](docs/api.md) share `convex/lib/ingest.ts`; RSS extraction has its own scheduled path. Content storage is constrained by Convex's document limit. Failed embeddings do not prevent an article from being stored.

Feed polling lives in `convex/actions/pollFeeds.ts`. A feed's first poll imports at most its three newest posts from the last 30 days and stores the oldest of them as `feeds.importAfter`; feeds with nothing recent or no usable dates store the 30-day cutoff. Every poll uses the later of that floor and the rolling 30-day cutoff, including existing feeds without an import floor. Undated entries are limited to the first three on every check. The 200-entry budget limits selected imports after filtering and sorting, rather than rejecting feeds with large archives. The 1 MiB body limit still bounds parsing. `feedPolling.status` reads the reader's run and the bounded slot pool for progress; a total is available only after selection ends. `feeds.checkRun` identifies current results so retrying hides old errors without hiding an identical failure from the new attempt. Posts are matched by guid and then by link, because Reader sync and pasted URLs use the article URL as the guid. A poll that adds articles schedules one `extractPending` run, which works through pending articles ten at a time (`EXTRACT_PAGE`) and reschedules itself while a full page remains. OPML import on Sources runs in the browser, adding one feed per `outline[xmlUrl]`.

The desk's time choices run in place: a choice calls `suggestions.forWindow`, a query that reads the nearest unread articles on each side of the window from the `by_user_annotationStatus_finishedAt_minutes` index (12 annotated/skipped, 4 deferred and 2 failed per side, with skipped text filling unused annotated slots) and scores only those. It returns the best three; `moreForWindow` pages the rest. The deck keeps cards already shown where they are, so live updates don't reshuffle them. Reading opens `/read/<id>?session=<id>`; old `/session/<id>` links redirect to the desk.

Reading candidates require extracted, nonempty content and exclude finished sources and book containers. Skipped annotations, including `no_provider` and short articles, do not prevent reading. Book picks still use the next unfinished part. Public counter fields retain their names, but `home.counts` and `home.overview` read `readableQueueStats`; compact `readableQueueEntries` receipts make live changes and the bounded backfill agree. Legacy `readingQueueStats` and `queueCounted` keep their old meaning. See [counter rollout and rollback](docs/operations.md#readable-queue-counters-use-an-independent-baseline).

Articles render through `@planetaryescape/reader`. The package inserts whatever HTML its `sanitize` callback returns, so Marginalia's trust policy lives in `components/article-renderer.tsx` (DOMPurify via `lib/sanitize.ts`). Saved highlights and companion passages are re-anchored against article text; paragraph navigation uses the rendered article body. `lib/paragraphs.ts`, `lib/text-range.ts`, `lib/highlights.ts` and `lib/reader-settings.ts` re-export the package so app imports stay stable. Change article markup or anchoring in the package, then bump its tag in `apps/web/package.json`.

## Estimated-page accounting

`readingPages.ts` owns prospective article page equivalents (300 words/page), optional goals and an exact daily ledger. The reader snapshots a bounded numbered-paragraph word manifest against saved prose identity. `page-coverage.ts` approximates exposed text with cells of up to eight words and consumes one shared active visual-reading allowance (220 words/minute); it does not sum the legacy per-paragraph dwell durations. No new arithmetic or tracking dependency is used.

The existing clock/outbox/checkpoint/beacon path carries cumulative **visit/day newly qualified** cell bitmaps. In the checkpoint transaction, `readingActivity` unions accepted visit coverage and a shared `readingPageSources` receipt, adds only previously uncredited words to `readingPageDays`, and keeps its legacy `null` return. Set union is monotonic under retries and reversed delivery; the shared receipt makes concurrent visits/reopens idempotent. New-day bitmaps exclude inherited coverage. Overlapping offline visits attribute shared cells to the first accepted recorded day. A V2 outbox isolates coverage from old clients that would strip unknown fields; legacy checkpoints remain readable and do not earn retrospective pages.

Source snapshots and credited words survive source edits, archive and completion. Changed manifests are deliberately untracked rather than resetting credit; books remain excluded until unit identity is part of the checkpoint contract. Bounds are 100,000 numbered words, 4,096 blocks and 17,000 cells per article. Exact day reads are indexed and capped at 90 calendar days, not reconstructed from capped visit-report projections. Account deletion purges both new tables and the existing late-checkpoint library fence remains in force.

Settings hold a fixed account timezone and current/pending goal schedule; day rows freeze the target observed when initialized. First enablement applies today, subsequent edits tomorrow, and disabling immediately hides feedback without changing today's snapshot. Offline checkpoints retain their known target if a day has not yet been initialized. There is no goal-event history/backfill. Calendar boundaries reuse timezone-aware Stats helpers. A root subscriber claims one acknowledged current-day achievement transactionally before using the existing toast; initial hydration and goal edits do not replay celebrations.

## Data and background work

Articles, annotations, sessions, interactions, notes, highlights, impressions, companion threads, summaries and saved/loved relationships live in Convex. Mutations are transactions; actions own extraction and external API calls. Background jobs are scheduled through internal functions.

Notes store rich-text HTML plus plain text. Plain text drives retrieval; HTML must be sanitized at render time. Editing a note clears its previous vector, schedules a fresh embedding and prevents stale jobs from committing against newer text. Deleting a note makes delayed embedding work a no-op.

Use `Doc`/`Id` from generated bindings and function argument validators at these boundaries. Run:

```bash
bun run typecheck
bun run test
```

## Contextual AI

Structured annotation/summary generation uses the AI SDK and Zod schemas. Passage and Library answers stream plain text through Convex HTTP actions. Each reader's own provider keys (OpenRouter, OpenAI or Anthropic) are stored AES-GCM encrypted in `providerCredentials`; `convex/lib/router.ts` decrypts them only inside the action making the call. Model choices are validated against the reader's available models in `convex/lib/providers.ts`, and fallbacks stay within that reader's own models. Embeddings use `text-embedding-3-small` through OpenAI or OpenRouter, with 1536 dimensions across the vector indexes. Read-aloud (`convex/speech.ts`) is the one other call that spends a reader's OpenRouter key: one paragraph goes to OpenRouter's speech endpoint and the MP3 comes back, with nothing stored.

Library context combines article material and the reader's stored activity. Search validates ranked results against the retrieved articles; a model cannot invent an arbitrary result ID. Context assembly lives in `lib/library.ts` and `lib/marginaliaContext.ts`.

Provider failure is part of the contract: malformed embeddings fail validation, interrupted streams report an error, and user input remains available for retry. Test the behaviour through the actual UI as well as the pure request/prompt tests.

## UI ownership

The `(desk)` route group owns navigation and reader colour tokens. The full article route owns reading settings and tools. Root providers supply Convex, light/dark mode, notifications and the shortcut sheet. Reader appearance is persisted in browser storage; model settings and content live in Convex.

`shortcuts.ts` provides one dispatcher so navigation sequences win over single-key reading actions. `use-modal-dialog.ts` centralizes modal focus. `note-autosave.ts` buffers and serializes saves without clearing unacknowledged text.

To verify a change here, navigate between desk routes and then open an article. The URL paths do not include `(desk)`.

## Vault indexing

The CLI reads Markdown, strips frontmatter for chunk content, hashes the complete source file and uploads embeddings. A dry run compares local files with remote hashes without embedding or mutating the index. Whole-file replacement commits atomically in Convex; incomplete embeddings leave the previous file's index intact.

The vault HTTP endpoints require a bearer key, separate from reader sessions and personal API tokens. Preview an index run using [the development guide](docs/development.md#optional-vault-index).

## Access boundary

Every public Convex function runs for one signed-in reader: `convex/functions.ts` derives `ctx.readerId` from the session, never from client arguments. The owner keeps the original `default_user` library ID; other readers get their own. Document lookups check ownership through `access.ts` (`ownedArticle`, `requireArticle`). Per-reader request budgets in `limits.ts` cap AI calls, key changes and API use. Requests from other apps carry a personal API token instead of a session and reach only that token's library. Read [operations](docs/operations.md#access-control) before deploying personal data.
