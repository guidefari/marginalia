# 02: Decisions

Every decision from the planning session on 2026-11-04, with the options rejected, so a later agent doesn't argue its way back into one. Guide is the decision-maker for this feature; BK approves merges, schema deploys and anything that changes the live product's boundaries. Change a decision only by adding a new entry that replaces it.

## The arc, briefly

1. Guide asked for EPUB import and reading, starting with iCloud and Apple Books, "almost a lift and shift" of Leaf, and wanted the UX discussed before any change.
2. Reading the code showed Marginalia already reads PDFs as books: upload, `bookUnits`, `?unit=N`, desk picks for the next part, highlights and notes anchored by `unitIndex`.
3. Leaf renders with foliate-js and anchors highlights by CFI. Porting that renderer would mean a second reader without Marginalia's margin, Explain, Listen and paragraph tools.
4. Guide rejected losing the publisher's layout and images, but chose the single reader. The answer was to keep structure, images and meaningful CSS inside Marginalia's reader.
5. Guide confirmed the Mac CLI and asked how owned, downloaded EPUBs would arrive with their Apple Books highlights, stating that "highlights are pretty important as part of the import".
6. Guide answered "yes to all four" to the remaining questions.

## Decisions

**D-EPUB-001: EPUBs use the existing book pipeline.** An EPUB becomes an `articles` row with `bookUnits`, read through the standard reader. Claude proposed; Guide chose ("I'd rather we go with Fork 1 so we maintain same ux"). Rejected: a new book model beside the PDF one.

**D-EPUB-002: no second renderer.** foliate-js is not embedded. Rejected because every reading feature would need a second implementation over foliate's iframes, and `apps/web/DESIGN.md` says a new content source is not permission to hide or replace reader features. Guide, as D-EPUB-001.

**D-EPUB-003: keep meaning, not looks.** Structure (headings, verse, block quotes, figures, tables, footnotes) and images survive. The publisher stylesheet is reduced to a fixed set of `bk-*` classes for alignment, indentation, small caps, italics and scene breaks. Publisher fonts and colours are dropped so themes and typography settings stay in charge. Guide: "this is not acceptible surely there's a way we can cater for this", then yes to this line. Rejected: loading publisher CSS whole (fights the themes and reader settings); text-only import (loses figures).

**D-EPUB-004: images live in Convex storage.** Each manifest image is uploaded once and its `src` rewritten. `slimHtml` strips only `data:` images, so stored URLs pass. Claude, accepted by Guide. Rejected: inline `data:` URIs (stripped, and they would blow the unit size budget).

**D-EPUB-005: scrolling only for now.** A paged mode via CSS columns can come later over the same data. Claude, accepted by Guide.

**D-EPUB-006: Apple Books import is a local CLI.** `packages/apple-books`, modelled on `packages/vault-indexer`, reading Apple Books' SQLite files read-only and calling the token API. Guide: "mac companion cli is fine". Rejected: in-browser import of the databases (the browser can't reach `~/Library/Containers`, and asking readers to find sandboxed SQLite files is hostile).

**D-EPUB-007: store purchases are not importable.** They are FairPlay DRM-protected. The CLI lists them with the reason instead of hiding them. A fact, not a choice.

**D-EPUB-008: upload Apple's copy when it exists.** CFIs are paths through the exact XML they were recorded against, so a differently packaged copy can shift every highlight silently. When Guide points the CLI at another file with the same publication identifier, it is still imported and unresolvable highlights are kept unplaced. Guide: yes. Rejected: refusing mismatched copies.

**D-EPUB-009: highlights are verified against their quote.** A CFI resolves to a unit and paragraph, then the quoted text must match there; otherwise a context-aware text search; otherwise the highlight is stored unplaced, visible in Notes and search with no mark. A highlight is never drawn on the wrong passage. Claude, accepted by Guide.

**D-EPUB-010: one-way, idempotent merge.** Keyed by Apple's annotation UUID. New Apple highlights are added, Marginalia edits win, deletions in Marginalia stick through tombstones, Apple deletions don't delete from Marginalia, nothing is written to Books. Ported from Leaf. Claude, accepted by Guide.

**D-EPUB-011: Apple purple maps to `cobalt`.** No new mark colour, so theme contrast tests are untouched. Blueprint assumes: Guide's "yes" answered an either/or question; confirm (Q1 in [03](03-open-questions.md)).

**D-EPUB-012: in-app import ships first.** The parser is shared by the desk upload and the CLI, so the drop works before the CLI exists. Guide: yes.

**D-EPUB-013: stacked pull requests from the fork, each targeting `main`.** Guide: "want to just do stacked pr's of this work". See [04](04-delivery.md) for why every PR targets `main`.

**D-EPUB-014: the stack is independent of PR #95.** #95 (local onboarding and registration feedback) touches auth only. Basing the EPUB work on `origin/main` keeps either from blocking the other. Claude; confirm with Guide if the EPUB branch needs #95's local sign-in fixes to run the app (Q2).

## Build-session decisions, 2026-11-04

**D-EPUB-015: blueprint and parser ship together.** Supersedes the standalone PR 0 in the original delivery plan. Guide rejected a documentation-only first PR: "lets fold it in with the parser". The first EPUB branch includes this blueprint, its corrected delivery plan, parser and generated fixtures. Revisit only if the documentation needs a separate review before further code.

**D-EPUB-016: the EPUB stack builds on auth PR #95.** Supersedes D-EPUB-014. Guide: "lets keep all my prs as stack, build on top of that auth thing". `feat/epub-parser` branches from `fix/local-auth-onboarding` at `bed850d`; later branches build on the parser. Upstream PRs still target `main` because their branches live on the fork. Reviewers use the parent commit boundary until parents merge. Do not change or merge #95 as part of parser work.

**D-EPUB-017: confirm purple maps to cobalt.** Confirms D-EPUB-011. Guide: "yeahhappy with that purple", accepting the proposed existing `cobalt` mapping rather than a new mark colour.
