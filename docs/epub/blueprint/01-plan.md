# 01: Plan

Marginalia reads PDFs as books: an upload becomes an `articles` row with an outline, its text stored as `bookUnits`, read through the standard reader at `/read/<id>?unit=N` and offered on the desk one part at a time. This plan adds EPUB as a second format in that pipeline, then a Mac companion CLI that imports EPUBs from Apple Books together with their highlights and notes.

Each phase is deployable on its own and maps to one or two pull requests ([04](04-delivery.md)). No phase changes how existing PDFs, articles, highlights or notes behave. The reasons behind each choice are in [02](02-decisions.md); what is still unknown is in [03](03-open-questions.md).

## Phase 1: EPUB parser

A pure, tested module at `packages/backend/convex/lib/epub/`, used by both the in-app import and the API. No Convex calls inside it.

1. **Open.** Unzip with `fflate`. Read `META-INF/container.xml`, then the OPF package: metadata (title, creators, unique identifier, language), manifest and spine. Parse XML with `@xmldom/xmldom`, the same choice Leaf made; the action runs under `"use node"` like `importPdf.ts`.
2. **Refuse early.** Missing container or OPF is `not_epub`. A `META-INF/encryption.xml` listing anything other than font obfuscation is `protected` (DRM). No readable spine text is `empty`. Past the size or unit cap is `too_long`.
3. **Outline.** EPUB 3 `nav` document, falling back to the EPUB 2 NCX, then to spine order with headings found in the text.
4. **Normalise each spine item** to the reader's HTML: an allowlist of structural tags (headings, `p`, `blockquote`, lists, tables, `figure`/`figcaption`, `hr`, `aside`, `sup`/`sub`, `em`/`strong`, `br` inside verse), relative links rewritten to unit links, scripts and forms dropped. Record the item's plain text with character offsets so later phases can map positions.
5. **Units.** Chapter-aligned. A chapter over the unit word budget splits at paragraph boundaries; a run of short items (title page, epigraph, dedication) merges into its neighbour. Each unit records the spine items and character ranges it covers.

Tests use small fixture EPUBs built in the test (EPUB 2 and 3, nested nav, an encrypted manifest, an unpacked-directory layout) rather than real books.

### Parser contract

`packages/backend/convex/lib/epub/parse.ts` exposes `parseEpub(bytesOrFiles)`: original ZIP bytes or a read-only map of archive-relative paths to bytes for an already unpacked directory. The caller owns filesystem access and zipping; the parser does no I/O, calls no Convex functions and changes no source bytes. It returns `{ ok: true, value }` or `{ ok: false, reason }`, where the reason is `not_epub`, `protected`, `empty`, `too_long` or `unreadable`.

The result contains metadata, the manifest, raster-image bytes, the original spine XHTML, normalized spine text, the outline and reading units. Images are inert `data-epub-image` placeholders containing an encoded archive path, with alt text retained. They are not browser-ready images until the storage action replaces them. Scripts, forms, publisher styles, event handlers, remote image sources and embedded active content never enter unit HTML. Font-obfuscation declarations are accepted only for manifest font resources; fonts are not rendered.

`sourceSpans` use zero-based spine indexes and half-open UTF-16 character ranges in each spine item's **normalized text**, not byte offsets, raw XHTML offsets or reader paragraph indexes. CFI placement must resolve against original XHTML and apply the same text normalization before mapping into these ranges. That placement is not implemented here. Units split between top-level reading blocks, preserving nested lists, tables and figures; an indivisible block over budget is refused rather than flattened or truncated. A short spine item merges into its neighbour.

Parser safety ceilings are 32 MiB input, 64 MiB declared expanded data, 8 MiB per entry, 4,096 entries, XML depth 128 and 100,000 nodes per document, 2,000 spine items/units, and 400,000 UTF-8 bytes plus 4,000 words per unit. ZIP entry budgets are checked before inflation. These are local parser bounds, not approval of a production upload size or account storage allowance (Q5). CSS reduction, semantic footnotes, covers and paragraph/CFI placement remain later phases.

## Phase 2: in-app EPUB import

Reuses the PDF flow end to end: upload grant bound to SHA-256 and size, `documentImports` row, background action, desk `ImportSlot`, "Ready to read" card, auto-open while still on the desk.

1. **Accept EPUBs.** `PdfPickerButton` and `PdfDrop` accept `.epub` (`application/epub+zip`). A dropped folder whose contents include `META-INF/container.xml` is zipped in the browser first, so an unpacked Apple Books folder works too. The copy becomes format-aware: "Couldn't read this EPUB", "A PDF or EPUB becomes a book in your library".
2. **Import action** `actions/importEpub.ts`: parse, write the book article and units in batches through the existing `books.createBookArticle` / `addUnits` / `finishBook`, and report steps through `documentImports.setProgress`. Failures use the existing cleanup so nothing is left half-imported.
3. **Images.** Each manifest image is stored once in Convex storage and its `src` rewritten to the storage URL. `slimHtml` only strips `data:` images, so stored URLs pass. Images over a per-image cap are dropped with their `alt` text kept as a caption.
4. **Ready card.** EPUBs have no page count: "24 chapters · parts of about 20 min", then "Starts with ...".
5. **Purge.** `books.discardBook`, article deletion and account deletion remove the book's images as well as its units.

**Schema (additive, needs approval):**

- `documentImports.format`: optional `"pdf" | "epub"`; absent means PDF, so existing rows are unchanged.
- `documentImports.failure` gains `"protected"` and `"not_epub"`.
- `bookUnits.sourceSpans`: optional array of `{ spineIndex, start, end }`, the character ranges the unit covers. PDF units leave it empty.
- New `bookImages` table: `userId`, `articleId`, `storageId`, `href`, indexed by article for purging.

EPUB limits get their own constants beside `MAX_PDF_BYTES`; the PDF limits are not loosened.

## Phase 3: layout fidelity

1. **Meaningful CSS.** Resolve the publisher stylesheet per element and keep only a fixed set of outcomes, emitted as scoped classes defined in `globals.css` against reader tokens: `bk-center`, `bk-right`, `bk-indent-1..3`, `bk-no-indent`, `bk-smallcaps`, `bk-italic`, `bk-verse`, `bk-break` (scene breaks). Everything else is discarded. The renderer's DOMPurify config already keeps `class`.
2. **Verse.** Line-broken poetry keeps its lines and indentation instead of reflowing into a paragraph.
3. **Footnotes.** EPUB 3 `epub:type="noteref"` links and their `footnote`/`endnote` targets become margin notes beside the reference, with the note text kept in the unit for search. Books without semantic markup keep a working link to the note and a link back.
4. **Covers** show on the Ready card and in Library rows.

Verify across every reader theme and at desktop and mobile widths with a few illustrated, poetic and footnote-heavy books.

## Phase 4: annotation API and placement

**Endpoints** (personal `mrg_` tokens, the existing per-library rate limit):

- `POST /api/v1/books/upload`: returns an upload URL for a given SHA-256 and size, or the existing book if those bytes were already imported.
- `POST /api/v1/books`: registers the uploaded file with an `externalId` (the publication identifier) and starts the same import action. Idempotent on `externalId`.
- `GET /api/v1/books/{id}`: import status, so the CLI can wait for units before sending annotations.
- `POST /api/v1/books/{id}/annotations`: a batch of `{ id, cfi, text, note, colour, underline, createdAt, modifiedAt }`. Returns placed, unplaced and skipped counts. Re-sending a highlight never uploads the book again.

**Placement**, in a pure module at `lib/epub/placement.ts`:

1. Expand Apple's offset-only CFI ranges (`epubcfi(/6/2!/4/2/1,:10,:20)` becomes `epubcfi(/6/2!/4/2,/1:10,/1:20)`), ported from Leaf with its property tests.
2. Resolve the CFI against the spine item's XHTML to a character offset, then through `bookUnits.sourceSpans` to a unit index, paragraph and in-unit offset.
3. Confirm the quoted text is there. If not, search the spine item for the quote, using surrounding text to choose between repeats.
4. If nothing matches, store the highlight **unplaced**: visible in Notes and search, no jump link and no mark in the text.

**Mapping into existing tables:**

- Highlight: `highlights` row, `kind: "underline"` for Apple underlines, colours yellow/green/blue/pink unchanged and purple to `cobalt`. Embedded like any other highlight.
- Note: `userNotes` row on the same passage, so it appears in the margin and Notes.
- Imported marks show a quiet "from Apple Books" label in Notes.

**Merge rules:** keyed by Apple's annotation UUID. Unknown ID: add. Known ID: leave alone, so Marginalia edits win. A tombstone: skip, so deletions stick. Apple deletions do not delete from Marginalia.

**Schema (additive, needs approval):**

- `highlights.source` gains `"apple-books"`.
- `highlights.externalAnnotationId` and `userNotes.externalAnnotationId`: optional, indexed by user and ID.
- `highlights.unplaced`: optional boolean, so book highlight queries can skip marks without a position.
- New `importedAnnotationTombstones` table: `userId`, `articleId`, `externalAnnotationId`. Deleting an imported highlight or note writes one. Account deletion purges it.

## Phase 5: Apple Books CLI

A private workspace package, `packages/apple-books`, run with `bun run --cwd packages/apple-books import`. Configuration (site URL and `mrg_` token) works like the vault indexer's.

1. **Library.** Open `BKLibrary*.sqlite` and `AEAnnotation*.sqlite` under `~/Library/Containers/com.apple.iBooksX/Data/Documents` read-only with `bun:sqlite`. List every book with title, author, highlight and note counts, and a status: importable, store purchase (DRM), not downloaded from iCloud, or file missing.
2. **Choose.** An interactive checklist, or `--all`, or a file path (`import ~/Downloads/book.epub`) matched to Apple Books by the EPUB's unique identifier.
3. **Upload.** Zip an unpacked Books folder in memory exactly as Leaf's `import-book.py` does (`mimetype` stored first, hidden files skipped). Hash it; skip the upload if the server already has those bytes.
4. **Annotations.** Live highlights only (`ZANNOTATIONTYPE = 2`, not deleted), newest revision per UUID, Apple-epoch dates converted. Send in batches once the book reports ready.
5. **Report** per book: parts, placed/unplaced counts, and nothing else. Note contents are never printed.

`--dry-run` lists what would be uploaded and sent without calling the API. Tests run against fixture SQLite files built in the test with Apple's table shapes.

## Documentation travels with the code

Each phase updates its own docs in the same pull request, as `apps/web/DESIGN.md` requires: `ARCHITECTURE.md` and `docs/limitations.md` (DRM, scrolling only) in Phase 2, `apps/web/DESIGN.md` (the `bk-*` classes) in Phase 3, `docs/api.md` and `docs/limitations.md` (unplaced highlights) in Phase 4, `README.md` and `docs/reader-guide.md` in Phase 5. Add the user-facing decisions to `docs/decisions.md` when the phase that ships them merges.

## Risks

- **Action limits.** Large illustrated EPUBs push the ten-minute action and memory budget. Images upload in a bounded loop with the import's existing expiry and cleanup; the size cap is set from measured fixtures.
- **Apple's database shape** is undocumented and can change with macOS updates. The CLI checks the columns it needs and stops with a clear message instead of guessing.
- **CFI drift** when the uploaded file is not Apple's copy. Quote verification makes this an unplaced highlight, never a mark on the wrong passage.
- **Storage growth** from images counts against the deployment. Purging follows every existing deletion path.
- **Production data.** Every schema change is an optional field, a widened union or a new table; no existing row needs migrating. Each still needs explicit approval before it is deployed.
