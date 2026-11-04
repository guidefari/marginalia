# Development and integration setup

Get the app running with [the README](../README.md#run-locally) first. Use your own Convex deployment: the existing reader's deployment contains personal content.

## Configuration reference

| Variable | Set where | Required for |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | `apps/web/.env.local`; Vercel web environment | Live queries and mutations; the `.convex.cloud` URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Same web environment | HTTP AI routes; `.convex.site`, derived from the cloud URL if omitted |
| `CONVEX_DEPLOYMENT` | `packages/backend/.env.local`, created by Convex CLI | Selecting the CLI's development deployment |
| `PROVIDER_KEYS_ENCRYPTION_KEY` | Convex deployment environment only | Encrypting readers' own AI provider keys; base64 of 32 random bytes (`openssl rand -base64 32`) |
| `OPENROUTER_API_KEY` | Local vault indexer environment only | The indexer's embeddings. The backend never reads it; every reader, including the owner, uses their own saved key |
| `READWISE_TOKEN` | Convex deployment environment (transition only) | The owner's Readwise sync until they connect their own token on the Sources page; never used for other readers |
| `SITE_URL` | Convex deployment environment | Canonical HTTPS web origin for auth; defaults to `https://reader.bhekani.com` |
| `BETTER_AUTH_SECRET` | Convex deployment environment only | Credential/session protection; random secret of at least 32 characters |
| `VAULT_INDEXER_API_KEY` | Convex deployment and local indexer environment, matching values | Authenticated vault index uploads and hash reads |
| `CONVEX_SITE_URL` | Local indexer environment | Vault HTTP endpoints, not the `.convex.cloud` URL |
| `VAULT_PATH` | Local indexer environment, or `--vault` argument | Vault directory to index |

Only deployment URLs belong in public web variables. Never prefix provider keys with `NEXT_PUBLIC_`, put secrets in docs, or commit a populated environment file. Use your password manager to inject secrets, or an ignored local env file.

The web app proxies auth and personal HTTP requests through same-origin `/api/auth/*`, `/api/reader/*` and `/api/engagement`; Convex queries use an authenticated JWT. Use a separate backend with disposable content for owner setup tests. [The rollout guide](operations.md#roll-out-owner-authentication) explains claiming and credential recovery limits. Local `convex-test` fixtures exercise authentication without enrolling a real owner.

## Enable AI

Each reader brings their own key. Set the server-side encryption key first, from the backend package so the CLI selects the correct project:

```bash
cd packages/backend
openssl rand -base64 32   # copy the output into the next prompt
bunx convex env set PROVIDER_KEYS_ENCRYPTION_KEY
```

Then open **Your account → AI providers** and save an OpenRouter, OpenAI or Anthropic key. The key is checked against that provider's model list, stored encrypted, and shown only by its last four characters. Search and Ask your library need an OpenAI or OpenRouter key (both embed with `text-embedding-3-small`); Anthropic covers answers, summaries and marginalia. Changing the encryption key makes saved keys unreadable, so readers would need to save them again.

The curated models per provider, role defaults and fallback order are in `convex/lib/providers.ts`; smoke-test availability before changing them. A reader without a key can still read, note and highlight; extracted articles remain in Library Up next and the desk's time choices even when annotations are skipped. AI features say to add a key.

The backend has no shared AI key. Every reader, including the owner, adds their own key in Your account.

Verify by adding one article in your own deployment, waiting for extraction and opening its annotations. Ask Explain for one passage, then use the desk's search.

## Enable Readwise Reader

Copy a token from [Readwise's access-token page](https://readwise.io/access_token), open **Sources**, paste it into the Reader card and connect. The token is checked, stored encrypted for that reader's library, and the card shows it is connected. Saving it needs `PROVIDER_KEYS_ENCRYPTION_KEY` on the deployment, as for AI keys.

A deployment `READWISE_TOKEN` (`bunx convex env set READWISE_TOKEN`) still works as a stopgap for the owner's library only, and only while the owner has no saved token (`convex/lib/ownerTransition.ts`). It never serves another reader. Use **Sync now** to start or resume the pull. The full Inbox (`new`), Later and Shortlist is imported in pages of five documents, with a minute between pages and paced annotation jobs. There is no total import cap. Older installations also get this full backfill, even if the earlier 100-item sync recorded a watermark. After backfill, each completed sync overlaps its incremental watermark by two minutes. Feed, PDFs, EPUBs, tweets and videos remain excluded, and Archive is never imported: after the first backfill it is only checked so articles you archive in Reader are finished in Marginalia; missing text and oversized documents are skipped. The card shows checked/imported/skipped counts and pending annotations. A large library takes time and incurs model costs as eligible new articles are embedded and annotated. Automatic sync starts or resumes every 15 minutes; successful pages continue without the browser staying open.

This integration is **not read-only**: reading actions can move a linked document between Reader locations, and highlights are pushed to Reader. Inspect `actions/readwiseSync.ts` before testing against a personal account. Use [operations](operations.md#readwise-sync) to verify a change without deleting real data.

## Optional vault index

Index only a vault you intend to send to external embedding providers and make available to this deployment. The CLI reads Markdown and writes remote index records; it never edits local notes. Preview before making changes:

```bash
cp .env.example .env.local
# Fill the local file with indexer configuration, or inject values with your password manager.
bun --env-file=.env.local run --cwd packages/vault-indexer index --vault /absolute/path/to/vault --dry-run
```

Expected: lists of files that would be updated or removed from the remote index, ending with **no remote data changed**. Dry run needs the site URL and matching vault key, but not the provider key. Read the list before proceeding:

```bash
bun --env-file=.env.local run --cwd packages/vault-indexer index --vault /absolute/path/to/vault
```

Unchanged files are skipped by hash. A changed file replaces its remote chunks only after all its embeddings succeed, in one Convex transaction. Partial embedding/upload failures leave its previous index and exit non-zero for retry. Files missing from the eligible local note list have their remote chunks deleted, so pointing at the wrong vault can remove the prior index. One deployment holds one vault, in the owner's library only: the vault key is deployment-wide and the upload endpoints always write to the owner (`convex/http.ts`), so other readers can't index a vault yet.

The scanner skips `.obsidian`, `.git`, `.smart-env`, `.smart-connections`, `Extras`, `node_modules` and Markdown files over 100KB. A read/frontmatter error aborts the scan before remote changes, rather than mistaking that file for a deletion. The chunker may skip small sections in multi-section notes and does not split a single oversized paragraph. Replacement accepts at most 128 chunks per file and requires 1536-dimensional vectors. Empty notes have no chunks and do not replace an old nonempty index. See [limitations](limitations.md) before treating the index as a complete copy of a vault.

## Commands

Run at the repository root:

| Command | Result |
| --- | --- |
| `bun run dev` | Runs both web and Convex watchers through Turbo |
| `bun run lint` | Biome formatting, imports and lint checks |
| `bun run lint:fix` | Applies safe lint and formatting fixes; inspect the diff |
| `bun run typecheck` | All workspace TypeScript, including generated Next routes |
| `bun run test` | Web tests, backend pure/mutation tests and indexer tests |
| `bun run check` | Lint → typecheck → tests |
| `bun run build` | Production Next.js build |

The web dev script runs through the project's exact-pinned Portless dependency at `https://marginalia.localhost`, with a dynamically assigned loopback port. `bun install --frozen-lockfile` installs it; a global Portless installation is not required. Node.js 24+ is required. First startup may request administrator approval for the local HTTPS certificate and port 443. Set that HTTPS URL as `SITE_URL` on an isolated Convex deployment to enable sign-in. Do not change the existing personal deployment's canonical origin for local setup. Next generates route types before typecheck so moved route groups do not leave stale references. Turbo build cache includes public Convex URLs and env files; changing deployments must not reuse a bundle with the previous URL.

On the desk, open the search field and choose **choose a PDF or EPUB**, or drop a file anywhere on the desk. PDFs support up to 60 MiB; DRM-free EPUBs support up to 32 MiB. Imports use the configured Convex backend, even when the web app runs locally. Use generated fixtures for cloud smoke tests; uploading a private book requires the owner's permission.

Backend mutation tests use `convex-test` and the edge runtime. Its version is currently pinned to a release compatible with the installed Convex SDK; update the pair together rather than ignoring peer dependency errors. Tests do not require a deployed backend or real credentials.

Web and backend Vitest suites each use at most three workers by default. The root test command runs package suites one at a time, keeping large fixture tests from competing with another package's workers and timing out under load. Test timeouts and coverage remain unchanged. Tests that need browser APIs select their browser environment per file, rather than changing the default Node environment for pure tests.

Web test workers use an `en-US` locale through `LANG` and `LC_ALL`, keeping number-format assertions independent of the developer's host locale. This is test configuration only; the application keeps its locale-aware display behavior.

## Make a safe change

1. Inspect the existing implementation and [recorded decisions](decisions.md).
2. Add regression coverage for changed behaviour, using fixtures rather than live records.
3. Run `bun run check` and `bun run build`.
4. Exercise the affected UI with keyboard, desktop/mobile widths and an empty/error state.
5. Review the diff, including generated bindings and env examples. Follow [deployment](operations.md#deploy) only after checks pass.

Do not run `convex dev` against the existing personal deployment merely to generate bindings: it uploads backend changes.
