# Marginalia EPUB books: feature blueprint

> EPUBs become books in Marginalia's existing reader, with their structure and images kept, and a Mac companion CLI brings in DRM-free books from Apple Books together with their highlights and notes.

Planned on 2026-11-04 in one session with Guide, who contributes to `planetaryescape/marginalia` from the `guidefari/marginalia` fork. BK owns the repository, merges pull requests and approves backend deploys. The request was to bring in "support for importing and reading epub books, first thing we want to support is importing from icloud or apple books, almost a lift and shift of what ../epub does", talking through the UX first. `../epub` is Leaf, Guide's separate single-user EPUB reader (foliate-js, Cloudflare D1/R2, Python scripts that read Apple Books' databases). The code was read at origin/main `ca37968`. This blueprint is for a coding agent that never saw the session, so it carries the reasoning as well as the result.

## Reading order

| # | Document | What it covers |
|---|---|---|
| 01 | [Plan](01-plan.md) | Six phases: parser, in-app import, layout fidelity, annotation API and placement, Apple Books CLI; schema changes and risks |
| 02 | [Decisions](02-decisions.md) | Every decision with its attribution and the options rejected |
| 03 | [Open questions](03-open-questions.md) | What to verify in code before building, and what to ask |
| 04 | [Delivery](04-delivery.md) | The stacked pull requests from the fork, and how to keep them rebased |
| K | [Kickoff](KICKOFF.md) | The prompt for the first build session |

Related: the design blueprint ([../../design/blueprint/README.md](../../design/blueprint/README.md)), whose concept and design gate this feature works inside; `apps/web/DESIGN.md` for shipped patterns; and Leaf's `README.md`, `PROVENANCE.md` and `scripts/import-annotations.py` in the sibling `../epub` checkout, which hold the Apple Books knowledge being ported.

## Summary

- **Shape:** EPUB is a second format in the PDF book pipeline (`documentImports`, `bookUnits`, `books`, `ImportSlot`), not a second reader (D-EPUB-001, D-EPUB-002).
- **Fidelity:** keep structure, images and meaningful CSS; leave fonts and colours to the reader's themes (D-EPUB-003, D-EPUB-004).
- **Apple Books:** a local, read-only CLI in `packages/apple-books`, like `packages/vault-indexer`, calling new token endpoints (D-EPUB-006).
- **Highlights are first-class:** CFIs resolve to unit and paragraph, are checked against the quote, and fall back to unplaced rather than a wrong mark (D-EPUB-008, D-EPUB-009).
- **Merge:** one-way and idempotent; Marginalia edits win and deletions stick (D-EPUB-010).
- **Order:** parser, in-app import, layout, annotation API, CLI (D-EPUB-012), shipped as stacked pull requests (D-EPUB-013).

## Build status

The first EPUB PR includes this blueprint and the pure parser, stacked on auth PR #95 (D-EPUB-015, D-EPUB-016). There is no separate docs PR. Uploads, reader integration, schema additions and the CLI remain planned, not shipped. Apple purple maps to the existing `cobalt` colour (D-EPUB-017); footnote PR scope remains open.

## Rules for coding agents

1. **Behaviour stays.** Existing PDFs, articles, highlights and notes must behave exactly as before. A widened shared component (the PDF picker, `ImportSlot`, `documentImports`) keeps its PDF tests passing unchanged.
2. **Schema is additive and approved.** Optional fields, widened unions and new tables only. Show Guide each change before writing it and never deploy a backend change yourself: BK approves deploys per `docs/operations.md`.
3. **Work inside the design concept.** Read `docs/design/blueprint/02-design-concept.md` and `apps/web/DESIGN.md`. Reuse `ImportSlot`, `InlineError`, `SavedMark` and the settings controls; check new screens in all six themes at desktop and phone widths.
4. **Keep personal content out.** The repo is public. No real books, Apple Books databases, highlights, notes or screenshots of a library in commits or PR bodies. Fixtures are built in tests.
5. **Read Apple Books read-only.** Never open its databases for writing and never write back to Books.
6. **Update the decision log.** Change a decision only by adding a new entry to [02](02-decisions.md) that replaces it.
7. **House rules.** Bun only. `bun run check` before every commit. Commits use `type(scope): description` with Guide as the only author and no co-author lines. No explanatory comments in code unless something is truly non-obvious.
