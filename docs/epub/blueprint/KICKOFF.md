# Kickoff prompt for the first build session

Paste this to the coding agent in `~/source/oss/marginalia` (remotes: `origin` is `planetaryescape/marginalia`, read-only; `fork` is `guidefari/marginalia`):

---

You're adding EPUB books to Marginalia: EPUBs read in the existing reader with their structure and images, and a Mac CLI that imports DRM-free books from Apple Books with their highlights and notes. It was fully planned in an earlier session you didn't see. Everything from that session is in this repo.

1. Read `docs/epub/blueprint/README.md` and every document it lists, in order. Read `02-decisions.md` before proposing any change of direction; the obvious alternatives (embedding foliate-js, text-only import, in-browser Apple Books import) were already rejected there. Read `docs/design/blueprint/02-design-concept.md` and `apps/web/DESIGN.md` too.
2. Skim Leaf in `../epub`: `README.md`, `PROVENANCE.md`, `scripts/import-annotations.py`, `scripts/import-book.py` and the CFI expansion in `src/reader/`. That is the Apple Books knowledge being ported. Don't copy its renderer.
3. Ask Guide Q1 to Q3 in `03-open-questions.md` if they're still open. Then answer V1 to V6 against the current `origin/main` and record the findings in `03-open-questions.md`.
4. Include this blueprint in `feat/epub-parser`, branched from `fix/local-auth-onboarding` at `bed850d` (PR #95). Guide superseded the original separate-docs PR and independent-stack plan in D-EPUB-015 and D-EPUB-016. Push to `fork`, open against upstream `main`, and state the parent commit boundary so reviewers can review only the EPUB changes. Leave the auth branch and PR #95 untouched.
5. Then climb the stack in `04-delivery.md` one PR at a time, each branch cut from the previous one. Before writing any schema change, show Guide the diff and wait for approval. Never deploy the backend.
6. Commit using `type(scope): description`, Guide as the only author, no co-author lines. Run `bun run check` before each commit.

Ask Guide about anything in `03-open-questions.md` when it comes up. Don't guess.

---
