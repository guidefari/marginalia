# 03: Open questions

## For Guide

- **Q1, answered.** Map Apple purple to `cobalt`; D-EPUB-017 confirms the choice.
- **Q2, answered.** Stack on `fix/local-auth-onboarding` at `bed850d`, not `origin/main`; D-EPUB-016 supersedes D-EPUB-014. Include the blueprint in the parser PR (D-EPUB-015).
- **Q3.** Footnotes as margin notes (Phase 3): keep in the first layout PR, or ship structure and images first and footnotes in a follow-up?

## For BK (through Guide)

- **Q4, partly answered.** Guide approved local implementation of the Phase 2 import schema in D-EPUB-018. Backend deployment still needs explicit approval. Phase 4 annotation schema remains unapproved.
- **Q5.** EPUB size cap and image storage per account, since images count against the deployment.

## Verify in code before Phase 1

Read at origin/main `ca37968`; recheck at the current `origin/main`.

- **V1.** How the `@planetaryescape/reader` package and `components/book-unit-nav.tsx` treat `<img>`, `figure` and `class` in unit HTML. The DOMPurify config in `components/article-renderer.tsx` adds tags and attributes on top of defaults.
- **V2.** How Notes and the reader handle a book highlight without `unitIndex`. This decides whether `highlights.unplaced` is needed or absence of a position is enough.
- **V3.** How `actions/importPdf.ts` builds units, so the EPUB action reuses `books.createBookArticle`, `addUnits` and `finishBook` and the same failure cleanup.
- **V4.** Whether `bookUnits` content budgets (`fitsInStorage`, 900 kB) leave room for figure-heavy chapters once image URLs are in the HTML.
- **V5.** The Apple Books library columns for file path and store purchase status on the current macOS. Leaf's `scripts/import-annotations.py` uses `ZBKLIBRARYASSET.ZEPUBID` and `ZASSETID` and `ZAEANNOTATION` fields; the path and store columns are unconfirmed.
- **V6.** Whether the token API router in `convex/http.ts` and `limits.ts` can take larger book uploads through an upload URL rather than a JSON body (today's article endpoint caps at 2 MB).

## Code findings, 2026-11-04

Fetched upstream `main`, still `ca37968`. Inspected the same code on the parser branch, whose additional parent commits touch auth and local startup only.

- **V1, checked.** `@planetaryescape/reader` sanitizes then renders the supplied HTML without flattening it. Marginalia's DOMPurify policy keeps default image/figure tags and adds `class`. `BookUnitNav` changes `?unit=N`. The parser emits inert `data-epub-image` references, not fetchable URLs; the later import action must replace them with owned storage URLs or captions. Internal links resolve to `?unit=N#epub-…` after splitting. Reader click interception and fragment restoration still need browser verification in the UI PR, not a claim from the pure parser tests.
- **V2, checked.** `highlights.listMine` includes marks without `unitIndex`, while a book reader calls `listByArticle` with an exact unit index. Notes builds a quote/paragraph link even without a unit index. Absence alone therefore does not meet the no-jump requirement for unplaced imports: the annotations PR must change the Notes link projection and decide its explicit unplaced contract before schema approval.
- **V3, checked.** `actions/importPdf.ts` uses `createBookArticle`, batches of 20 `addUnits`, then `finishBook`. It checks import liveness around writes and calls `discardBook` on partial failure. The EPUB parser makes no Convex calls; the later action must reuse that lifecycle, not copy PDF extraction.
- **V4, checked.** `importContent.fitsInStorage` allows less than 900,000 UTF-8 bytes for HTML plus text. Existing PDF units cap those fields at 400,000 bytes. The EPUB parser also caps them at 400,000 and 4,000 words per unit, splits between top-level reading blocks, and refuses an indivisible oversized block. Stored image URLs still require a final size check after replacement in the action.
- **V5, not verified.** A read-only schema-only check found no `BKLibrary/*.sqlite` at Leaf's expected macOS location in this session. No book or annotation rows were read. File-path and store-status columns remain a CLI prerequisite; do not guess them.
- **V6, checked.** The personal-token HTTP API currently has article routes, not book-upload routes. `documentImports.generateUploadUrl` already sends PDF bytes straight to Convex storage, with only SHA-256 and size in the mutation. The later token endpoint can use the same storage mechanism behind token ownership and the existing `api` rate budget (60/minute); the JSON article cap does not need loosening. This is an available design path, not an implemented endpoint.
