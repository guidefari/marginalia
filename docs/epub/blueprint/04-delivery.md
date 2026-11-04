# 04: Delivery

The work ships as a stack of small pull requests from `guidefari/marginalia` to `planetaryescape/marginalia`, each one reviewable and deployable on its own.

## Why every PR targets `main`

Guide has read access to the upstream repository, so branches live on the fork. A pull request from a fork can only target a branch in the upstream repository, never another fork branch. A conventional stack (PR 2's base set to PR 1's branch) is therefore impossible. Instead:

- Each branch is cut from the previous branch in the stack.
- Each PR targets upstream `main`, so until its parent merges it shows the parent's commits too.
- Each PR body starts with `Stacked on #<parent>. Review only the commits after <parent's last commit>.` and lists the whole stack.
- Upstream squash-merges (`… (#94)`), so after a parent merges, rebase the child onto `main` and drop the parent's original commits:

```bash
git fetch origin
git rebase --onto origin/main <parent-branch> <child-branch>
git push --force-with-lease fork <child-branch>
```

`<parent-branch>` is the local branch name of the merged parent, which still marks where the child's own commits begin. Then remove the "Stacked on" line from the child's body.

## The stack

| # | Branch | Contents | Schema |
|---|---|---|---|
| Parent | `fix/local-auth-onboarding` | Auth and local setup, upstream PR #95 | none |
| 1 | `feat/epub-parser` | This blueprint and Phase 1: `lib/epub/` parser, unit splitting, fixtures, `fflate` and `@xmldom/xmldom` | none |
| 2 | `feat/epub-import-backend` | Phase 2 backend: `importEpub` action, images to storage, purge paths | `documentImports.format`, new failures, `bookUnits.sourceSpans`, `bookImages` |
| 3 | `feat/epub-import-desk` | Phase 2 UI: picker and drop accept EPUBs and folders, format-aware copy, Ready card | none |
| 4 | `feat/epub-layout` | Phase 3: `bk-*` classes, verse, covers, footnotes (or footnotes split out, Q3) | none |
| 5 | `feat/epub-annotations` | Phase 4: CFI expansion and placement, book endpoints, merge and tombstones | `highlights.source`, `externalAnnotationId`, `unplaced`, tombstone table |
| 6 | `feat/apple-books-cli` | Phase 5: `packages/apple-books` | none |

The first EPUB branch starts from `fix/local-auth-onboarding` (#95) at `bed850d`, as Guide chose in D-EPUB-016. There is no separate blueprint PR (D-EPUB-015). PRs 2 and 5 carry schema changes and need approval before writing them, and BK's approval before any backend deploy.

## Each PR

- Passes `bun run check` and `bun run build`.
- Updates the docs its change affects ([01](01-plan.md#documentation-travels-with-the-code)).
- Describes what was verified in the browser, without personal library content.
- Ends with no co-author or tool attribution lines.

## Parser implementation log, 2026-11-04

- Added the pure parser and generated-fixture tests under `packages/backend/convex/lib/epub/`, with exact-pinned `fflate` 0.8.3 and `@xmldom/xmldom` 0.9.12. No schema, API, UI or registered backend function changed. No backend deployed.
- Tested an owner-provided EPUB privately, read-only and without uploading it. It produced 38 spine items, 317 outline entries, 40 raster images and 45 units. Every unit stayed within the parser budgets; the largest had 3,969 words and HTML plus text occupied at most 91,998 bytes. No publication content, title, identifier, source path or checksum is retained in this log or fixtures.
- That real-book check found source-range drift when empty anchor blocks preceded text. A generated regression fixture reproduced the failure before the fix. The final private check found zero source-range mismatches and zero active-markup units; hashing the source before and after confirmed it was unchanged.
- Full root test execution passed all 2,192 backend tests and all 32 vault-indexer tests. The frontend retained the six previously documented base failures: four missing-session-storage cases and two locale-dependent decimal expectations. The first backend run, concurrent with the build, hit two existing five-second test timeouts; the later root run passed them without code or timeout changes.
- All 22 parser tests pass in both the package's edge-runtime test environment and Node. Typechecking passes across all three packages, and changed TypeScript/package files pass Biome. Fixtures cover EPUB 2/3 navigation, structure, link rewriting, image placeholders, exact source ranges, malformed and protected input, and parser budgets.
- `bun run build` passed with existing CSS pseudo-element and Browserslist warnings. `bun run check` stopped at the same eight unrelated formatting errors documented on the auth PR; unrelated files were not reformatted. Reader/browser verification is not claimed: the parser is not connected to the app yet.
- Delivery remains unmerged. Next is the backend import PR, after the proposed schema diff receives approval. Footnote scope and production size/account-storage allowances remain open.
