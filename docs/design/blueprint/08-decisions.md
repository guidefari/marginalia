# 08: Decisions

Every decision behind this design blueprint, including the options we rejected, so a later agent doesn't argue its way back into one. BK is the decision-maker. The attribution after each heading says whose call it was:

- **(BK)** means BK said it, quoted where his words are available.
- **(BK, recorded in docs/decisions.md)** means a request from the 2026-10-11 polish conversation. That transcript can't be recovered (`PRODUCT.md` says so too), so these carry the recorded reason, not his words.
- **(Claude, delegated by BK)** means the agent decided it while writing this blueprint, inside the remit of BK's request.
- **(Blueprint assumes; Qn)** means a design choice BK hasn't made yet. The documents proceed on it, and [09](09-open-questions.md) asks him to confirm it.

Change a decision only by adding a new entry that replaces the old one.

## The arc, briefly

1. Marginalia was built feature-first. It started in April 2026, got a large polish pass on 2026-10-11 (one-screen Home, floating search, keyboard map, PWA), and then took on archive, dark-theme fixes, performance and Readwise import on 2026-10-14 and 2026-10-15.
2. Each request was met behaviourally. On 2026-10-16 BK judged the result: the features work, but nobody designed the product as a whole.
3. No design conversation took place. This blueprint comes from four sources: BK's request, his remarks while using the app, the constraints recorded in `docs/decisions.md`, and an audit of the live app at origin/main `bc23f5e` ([01](01-current-state.md)).
4. The audit found strong typography and palettes, plus one excellent moment: the margin card. Around them, everything carries equal weight. Annotations hide behind superscript numbers, the pen colour paints the chrome, and the navigation has grown to seven destinations.
5. We read the existing code's own vocabulary, *pen* and *highlighter*, as the start of a concept. Three hands write on the page: print, pencil and pen. The blueprint proposes that concept and asks BK to confirm it (Q1).

## Decisions

### D-DES-001: The functions stay; this work designs the product around them. (BK)
- **BK:** "focus on the design aspect. The functions but i don't think the design was considered" (2026-10-16).
- **Why:** behaviour is already broad: annotations, companion, notes, ratings, activity, sources, readers. What's missing is a concept, hierarchy and a single way of doing things.
- **Option rejected:** a functional rewrite or new features alongside the redesign. That breaks BK's "fix before adding" rule and would hide whether the design work landed.

### D-DES-002: Home stays one wide, attractive screen with no scrolling, on desktop and on a phone. (BK, recorded in docs/decisions.md)
- **Why (recorded):** the reading desk should make the next read immediately available.
- **Consequence here:** the redesign of Home in [04](04-desk.md) removes elements instead of adding them, because the one-screen constraint is fixed.

### D-DES-003: Search is a floating picker opened by a click or `/`. It explains its matches and accepts pasted URLs. (BK, recorded in docs/decisions.md)

### D-DES-004: Everything works from the keyboard, and focus is visible but quiet, never loud blue. (BK, recorded in docs/decisions.md)
- **Why (recorded):** loud blue highlights distracted from the reading design.
- **Consequence here:** the keyboard stays complete, but its *hints* go quiet (D-DES-021). Keyboard access and keycaps painted on every surface are different things.

### D-DES-005: Ratings show stars with meaningful labels. (BK, recorded in docs/decisions.md)
- **Why (recorded):** shortcut hints alone didn't make rating understandable.
- **Drift found:** Library's impressions column draws five squares in the pen colour (`library/page.tsx`, `RatingMarks`), while the reader's impression panel draws stars. The redesign uses stars everywhere ([05](05-library-notes-week.md)).

### D-DES-006: Note editors focus when they open and autosave. (BK, recorded in docs/decisions.md)

### D-DES-007: Dark themes are first-class, not inverted light themes. (BK)
- **BK:** "why are these things white in dark theme? they are a bit jarring" (2026-10-15, about the floating controls).
- **Why:** BK reads in the night theme. Anything designed in light and inverted afterwards shows up there first.
- **How to apply:** every comp and screenshot in the design gate is made in Night and Paper at minimum ([02](02-design-concept.md#the-design-gate)).

### D-DES-008: Every main destination shares one frame: the same header, theme and phone navigation. (BK, recorded in docs/decisions.md)
- **Why (recorded):** legacy routes such as Notes once dropped the navigation and changed layout.

### D-DES-009: Speed is part of the design. The app should feel instant. (BK)
- **BK:** "I wan tthe app to fly" (2026-10-15).
- **Why:** waiting on a reading desk breaks the moment of "I have ten minutes". The 2026-10-15 performance pass brought time windows to 0.47–1.1 s. Design treats the rest: optimistic transitions, prefetching on intent, and no full-screen loaders where a skeleton of the real layout would do (S3).

### D-DES-010: The desk offers only what BK hasn't read. (BK)
- **BK:** "The idea is to not get suggested something I've read already" (2026-10-14).
- **Consequence here:** finishing an article is a visible moment that takes the article off the desk ([03](03-reader.md#finishing)).

### D-DES-011: The phone is a real reading surface, installable as a PWA. (BK, recorded in docs/decisions.md)

### D-DES-012: Sources are set up once and then stay out of the way. (BK)
- **BK:** on importing feeds by exporting and re-importing OPML: "the process of exporting opml files and then imporing is quite manual. are you saying this can't be an automated sync process?" (2026-10-15).
- **Why:** BK wants sources to run themselves. The Sources screen is for setup and for diagnosing problems, not for daily attention ([06](06-sources-and-settings.md)).

### D-DES-013: Preserve the reading-first design, the user's notes and reading history, and the multi-reader model. (BK, recorded in docs/decisions.md)
- **Why (recorded):** polish must not replace personal reading history. Don't turn a polish pass into a multi-user rewrite.

### D-DES-014: This is a feature-scale blueprint at `docs/design/blueprint/`, with decision IDs prefixed `D-DES-`. (Claude, delegated by BK)
- **Why:** the app and its docs already exist. This blueprint covers the design layer only and must not read as a plan to rebuild.

### D-DES-015: Behaviour changes only where the design needs them, and each such change is named in the domain document that needs it. (Claude, delegated by BK)
- **Why:** follows from D-DES-001. The named exceptions are moving Saved into Library (D-DES-024), grouping Sources, Account and Readers as settings (D-DES-025), showing margin notes without a click (D-DES-019), and showing the time-window pick on the desk (D-DES-028).

### D-DES-016: The repo is public, so the blueprint contains no personal library content, account details or screenshots. (Claude, delegated by BK)
- **Why:** `planetaryescape/marginalia` is public on GitHub, and the live library contains BK's notes, including work material. Screens are described in words and ASCII. Audit screenshots stay local.

### D-DES-017: Keep the six themes, the three type families, the shared `@planetaryescape/reader` package and the four annotation colours. (Claude, delegated by BK)
- **Why:** the audit found typography and palettes to be the strongest part of the app ([01](01-current-state.md#what-already-works)). Replacing them would cost the identity BK already lives with and would gain nothing the concept needs.

### D-DES-018: The concept is "Print, pencil and pen". The author speaks in print, Marginalia in pencil, and the reader in their own pen. (Blueprint assumes; Q1)
- **Why:** it names the product's real job (a reading with a second voice beside it). It builds on the vocabulary already in the code (`--pen`, `--highlighter`, pen colours), and it settles hierarchy and colour arguments by asking whose hand an element belongs to.
- **Options rejected:** (a) "Reading desk" as the whole concept. It already exists in the docs, and it describes Home but not the reader, where the hours are spent. (b) "Lamplight / reading room", a mood without a rule. It says how things look but doesn't decide which element wins. (c) A neutral "clean minimal" pass. That brings restraint without identity, which is the keyloom failure in a different form.

### D-DES-019: On wide screens, margin notes live in the margin as quiet sidenotes beside their line, without a click. (Blueprint assumes; Q6)
- **Replaces** the current one-card-at-a-time margin popover opened from superscript numbers.
- **Why:** the product is named after notes in the margin, and at 1440 px the reader leaves about 400 px of empty margin to the right of the text. Hiding the margin behind numbered markers makes the product's main idea a hunt.
- **Option rejected:** keeping footnote-style markers. They are calm, but they turn the companion into an appendix nobody opens.
- **Risk:** a crowded margin on heavily annotated articles. Collision rules are in [03](03-reader.md#the-margin), and density is S2.

### D-DES-020: Colour belongs to a hand. Chrome is ink; the pen colour is used only for the reader's own marks. (Blueprint assumes; Q7)
- **Why:** today `--pen` (blue by default) also colours links, the drop cap, rating marks, progress and primary actions. The reader's own highlights then can't stand out from the interface.
- **How to apply:** see [02 Visual language](02-design-concept.md#visual-language).

### D-DES-021: Keycap hints are hidden by default and appear on demand. (Blueprint assumes; Q8)
- **Why:** the audit counted nine keycaps on Home (`1`–`4`, `/`, `c`, `j`, `k`, `?`). They make a calm desk look like a cheat sheet. Keyboard users learn the map from `?`, tooltips and a held modifier ([02](02-design-concept.md#shared-patterns)).

### D-DES-022: Remove the GitHub link from the header and the reader toolbar. (Blueprint assumes; Q9)
- **Why:** it is the project's link, not a reading tool, and it takes a permanent slot on every screen. It moves to the account page footer.

### D-DES-023: Maintenance actions ("Re-annotate with latest vault") leave the reader toolbar for the article's overflow menu. (Blueprint assumes; Q11)

### D-DES-024: Primary navigation becomes three rooms: Desk, Library and Notes. Saved becomes a Library shelf, and This week becomes Notes → Your week. (Blueprint assumes; Q3)
- **Why:** seven destinations (eight with Home on the phone) give equal weight to things BK does daily (read, find) and things he does rarely (sources, readers). The phone bar is too narrow for labels on small screens, which `site-header.tsx` itself notes in a comment.
- **Options rejected:** (a) keep all seven and restyle them. That keeps the equal weight. (b) A sidebar. It costs reading width on the desk and adds chrome.

### D-DES-025: Sources, Account and Readers move behind the account menu as Settings pages that share one form pattern. (Blueprint assumes; Q4)

### D-DES-026: On a phone, opening a margin note unfolds it in the text flow below its paragraph instead of a bottom sheet. (Blueprint assumes; Q5)
- **Why:** a sheet covers the passage the note is about. In-flow keeps the note and its line on screen together, the way a note would sit in a narrow book's footer.
- **Way back:** the bottom sheet exists today (`margin-card.tsx`, `kind: "sheet"`). If S2 shows that in-flow reflow loses the reading place, return to the sheet.

### D-DES-027: Design work ships in rungs that each pass a design gate, not only tests. (Claude, delegated by BK)
- **Why:** this is the lesson of keyloom (2026-10-16), and the reason this blueprint exists. See [02 The design gate](02-design-concept.md#the-design-gate) and [07](07-roadmap.md).

### D-DES-028: Choosing a time keeps you on the desk. The pick appears in the desk's main slot instead of on a separate full-screen page. (Blueprint assumes; Q12)
- **Why:** `/session/[id]` leaves the desk frame and uses legacy colour classes ([01](01-current-state.md#choosing-a-time-leaves-the-desk)). The core action should feel like the desk answering, not like being sent somewhere.
- **Behaviour kept:** the session record, `suggestions.forWindow`, the frozen first result set, Read now / Save / Another. The `/session/[id]` route stays as a deep link that renders the same desk state.
- **Option rejected:** restyling `/session/[id]` onto the tokens and leaving the flow alone. That fixes the colour but keeps the hand-off break.

### D-DES-029: BK confirmed the concept, the colour rule and the reader toolbar before rung 1. (BK)
- **BK, 2026-10-16, answering Q1, Q2, Q7, Q9, Q10 and Q11:** yes to "Print, pencil and pen"; the pen colour marks only his own highlights and notes; the drop cap is drawn in ink, stays on by default and stays a setting; the GitHub link moves to the account page footer; Re-annotate moves into the article's ⋯ menu. His taste references are Tufte / gwern.net sidenotes, iA Writer and Things 3. He did not pick Readwise Reader as a model.
- **Consequence:** D-DES-018, D-DES-020, D-DES-022 and D-DES-023 are now BK's decisions, not assumptions. The remaining questions (Q3–Q6, Q8, Q12) are asked before the rung that needs them.

### D-DES-030: BK confirmed the margin, phone notes, keycaps and the pick on the desk. (BK)
- **BK, 2026-10-16, answering Q5, Q6, Q8 and Q12:** margin notes always show quietly beside their line on wide screens; on a phone a note unfolds under its paragraph; keycap hints are hidden and revealed by `?` or holding Alt; choosing a time shows the pick in the desk's main slot.
- **Consequence:** D-DES-019, D-DES-021, D-DES-026 and D-DES-028 are now BK's decisions. Q3, Q4 and Q9's remaining part are asked before rung 4.

### D-DES-031: Choosing a time lets you keep going through every article that fits. (BK)
- **BK, 2026-10-16:** "when I select a time, Why am I shown just three articles? Why can't I keep going through the articles that fit that time".
- **Replaces** the frozen three-card set in D-DES-028's "Behaviour kept". The best three picks still come first; Another and Save then continue through every unread article no longer than the window, closest length first, until none are left.

### D-DES-032: Loving an article is the reader's mark, so the filled heart is in the pen colour. (Claude, delegated by BK)
- **Why:** under D-DES-020 the pen colour belongs to the reader's own marks. A rating and a love are both the reader's judgement, so both use it.

### D-DES-033: Marginalia exists so BK never faces the pile: say how much time you have, get one thing you can finish, and read it. (BK)
- **BK, 2026-10-16:** "when i was using readwise reader when i land I am overwhelmed with a tonne of articles I need to read and i dn't know where to start. picking a time is great because sometimes I just have 5 mins to read and I don't want to start soemthing and then be stopped midway, etc. It's a better way to get something to read and read it."
- **Why it's recorded:** this is the product's reason to exist, and the first version of this blueprint didn't state it. It named the reader page the hero and treated the desk as one screen among many. The desk is the half of the product that replaces the pile; the reader is the half where the time is spent. Every desk decision is judged against this entry.

### D-DES-034: The desk never shows the backlog's size and offers only what fits the time chosen. (Claude, delegated by BK; follows from D-DES-033)
- **Never the pile:** no "130 articles waiting" on the desk. Counts live in Library, where BK goes on purpose.
- **Only what fits:** a time choice offers only articles no longer than the window. When nothing fits, the desk says so and offers the shortest article as a labelled choice. Today `suggestions.forWindow` returns articles up to 1.3× the window and labels longer ones "longer than requested"; D-DES-031's fix changes that.
- **Continue shows minutes left**, so it answers the same question as the time choices.
- **Option rejected:** keeping the count as "one quiet line". Any number there is the pile in miniature.

### D-DES-035: Up next leaves the desk; it lives only as a Library shelf. (BK)
- **BK, 2026-10-16, answering Q13:** remove it from Home.
- **Why:** a list of what's waiting is the pile in miniature (D-DES-033). The desk is the question, the one pick or Continue, and search. The Up next section in [04](04-desk.md#up-next-lives-in-library) now describes the Library shelf's rows, and archiving from them moves with it.

### D-DES-036: Topic search is the second way in, and it answers one article at a time, fast. (BK)
- **BK, 2026-10-16:** "The othe way of finding what to read is opening the bar and saying the topic I want to read about then I get the articles that I could read (with a clear annotation of reading time). This fits into the philosophy, the problem I have with how it works today is two things: 1: it takes too long to return a result, i might have bounced by then. 2: it still gives me a list after that which can be overwhelming, we should keep the thing from the time selector where the articles are presented to me one by one."
- **Consequence:** the bar shows one match at a time with its reading time and a reason, like a time choice. The first card comes from the search alone; the model's explanation fills in after. Library keeps the full list ([04](04-desk.md#topic-search-the-second-way-in)).

### D-DES-037: Once an article is open, the reader keeps BK there, reading, reflecting and not too impressionable. (BK)
- **BK, 2026-10-16:** "When an article has been selected, the reader should optimise to keep me there and keep me reading and keep me reflecting on this article and it's connections to other things I've read and importantly, help me not be too impressionable by telling me about tensions, counterpoints, showing me logical fallacies, etc. That's why I love that bottom section so much because sometimes when I read an article that's written well, i believe the author too much because of recency bias and just being enamoured about a well written thing."
- **Found:** the reflection prompt already says its job is "to slow down premature agreement" (`generateAnnotations.ts#L112`, origin/main `75a3eae`). The design hadn't put it at the centre.

### D-DES-038: The margin leans toward pushback, close to balance; fallacy is its own kind; kinds come in three families; nothing moves on automatically. (BK; kinds proposed by Claude and agreed)
- **BK, 2026-10-16:** "margin should lean towards pushbacck but very close to balance. fallacy should be it's own visible kind, you can think of any other kinds that help a piece logically that I havenn't thought of besides falacy. Yes, connections can read articles i dind't mark, it can be a discovery tool as well. No moving on automatically."
- **Kinds (Claude proposed, BK agreed the families):** pushback (tension, fallacy, assumption, unsupported, other explanation), support (strong point, crux), connection (connection, context, question). Support exists so the pushback is credible.
- **Option rejected:** one colour per kind. Nine dots can't be told apart at a glance.

### D-DES-039: Stay on the page: every reader tool answers beside the text so BK never leaves to understand something. (BK)
- **BK, 2026-10-16:** "this app is designed to keep you in the reading page because one of my issues is if for example I see a word I don't know and i go to a dictionary or google for a definition. Something else might catch my attention there and then I don't come back. That's why define is a tool right there and I can see a definition in the margin in context, once I understand, i can carry on reading. same for all the other tools like ask simplify explain etc."

### D-DES-040: A connection can be saved for later but is never a link; Saved is the reading list and is boosted in picks; connections reach the whole library as discovery. (BK)
- **BK, 2026-10-16:** "A connection can have a add to reading list, things added to reading list get a boost in recommendation. But it doesn't create a link that will take me there because then it contradicts the requirement of keeping me there. So i can be told of a connection and if I like it I click bookmark or whatever and then keep reading. The bookmarks will find me in a next reading session somewhere because they are boosted."
- **BK:** reading list is the same as today's Saved. Connections can reach articles he didn't mark (D-DES-038).
- **Rule:** the boost never breaks "only what fits" (D-DES-034).

### D-DES-041: Marginalia reads alongside: a second annotation pass runs as BK reads, ahead of where he is. (BK)
- **BK, 2026-10-16:** "would be nice if like you said, the thing reads with me like you were just saying as I read it's looking at the article and parts I haven't gotten to and annotating. I think the limit of 3 - 7 that I gace was too limiting so we should increase it without making the annotations overwhelming. Also the ai answers and annotations should be just as long as they need to be and no more so that they don't end up being another distraction."

### D-DES-042: Notes are budgeted by density, not a fixed 3–7, and every note and answer is as long as it needs to be. (BK)
- **BK, 2026-10-16:** "the limit of 3 - 7 that I gace was too limiting" and answers "should be just as long as they need to be and no more" (D-DES-041).

### D-DES-043: Bring your own: the bar takes a topic, a URL or a PDF, and what BK brings opens straight away. (BK)
- **BK, 2026-10-16:** "Sometimes I know exactly what I want to read. i come with an article url (that's why the search box can also take a URL) we also need to support PDF upload, if I come with a pdf upload."
- **New capability:** PDF import doesn't exist today. Flagged once under BK's product discipline; his words are the need.

### D-DES-044: A link in the article offers choices and never navigates on a plain click. (BK)
- **BK, 2026-10-16:** "When there's genuine link to elsewhere in the body of the article, clicking it shouldnt' automatically send me off. it should offer me choices. something like bookmark, add to reader, and open as the last choice and even then it opens in a new tab in the background, it doesnt' immediately take me there."
- **Assumed (Q17):** "bookmark" and "add to reader" are one action, Save for later, which imports the page into Marginalia's library as Saved.

### D-DES-045: Marginalia's answers are temporary until BK keeps them; his own writing saves automatically. (BK)
- **BK, 2026-10-16:** "Don't auto save things I ask or define etc. sometimes they are just ephemeral and I don't want to keep them. i want to choose intentionally when to persist something to my notes. But if there's an annotation and then I add my reflections. You should save that automatically."
- **BK, on how long:** "you can keep them as long the article is still open, even when i refresh, because I cold ask something read on and then be like what was that again, I shouldn't have to run another quiery. it only disappears if I close the article."
- **Replaces** today's behaviour, where every finished answer is saved (`companion.ts#L204`).

### D-DES-046: The reading-time pass runs only when something relevant has changed since the last one. (BK)
- **BK, 2026-10-16:** "Keep when the article was last read and now many new things came in after that. No need to reread an article everytime if maybe it was last read yesterday or my notes and articles and references haven't changed at all. It's just wasting tokens at that point."

### D-DES-047: The summary reads in order of increasing detail: the one point, the short summary, the idea map. (BK)
- **BK, 2026-10-16:** "The summarise this article for me should order things in progressive complexity. So “the one point” is first, soemtimes I can read that and I can already decide whether I want to read this or not. Sometimes after reading that I can still be like I want to know more, in which case the little summary blurb is the next thing i read. And then the idea map."

### D-DES-048: The idea map is designed for legibility, by the prompt and by a crossing-minimising layout. (BK)
- **BK, 2026-10-16:** "The idea map in te summarise this article at the top is great but the connections sometimes cross each other in a confusing way and all that. Basicallly that little diagram could look better because for long complex articles it can get noisy, prompt the model to pay attention to the design of that idea map."
- **Found:** today's layout is longest-path layering with one ordering pass (`idea-map.tsx#L61-L112`), which leaves crossings.

### D-DES-049: An opened margin note pushes the notes below it down; it never floats over them. (BK)
- **BK, 2026-10-16, on the live margin:** "this kinda looks ugly, with the popover on top of the othe marginalia, it's weird, mabe when you expand one, it pushes the other compressed ones as it opens so that it feels nicer".
- **Replaces** S2's rule 7 (an open note floats and re-runs no collisions). The open note stays in the column at the column's width; notes below slide down by transform over `--motion-move` and back on close; notes above stay.

### D-DES-050: The reader's notes pane is non-modal: the article stays usable while it's open. (BK)
- **BK, 2026-10-16:** "the notes pane when it's open I can't do anything, I don't like that" and "I wan tto be able to have notes open and still do things on the article".
- **Shipped** at origin/main `76d3820`: the pane is an `<aside>`, not an open `<dialog>`; on wide screens it docks at 380 px and the text shifts left (`--notes-inset`); on phones it's a half-height sheet. A new passage selected while a note is open saves the first note before starting the second.
- **Invariant:** never use an open `<dialog>` for non-blocking UI; `lib/shortcuts.ts` and `margin-card.tsx` treat `dialog[open]` as modal.

### D-DES-051: The foundation: AI as a thinking partner. It thinks with BK, never for him, and never waits to be told. (BK)
- **BK, 2026-10-16:** "This whole app fits in the philosophy I believe in that AI should be a thinking partner. It's not thinking for me and I'm not thinking for it and just telling it what to do. It's thinking with me and we're working together. It's augmenting my thinking"
- **BK, on recording it:** "this is a foundational principle so you should explain it well."
- **Why it's first:** every product decision in this log is a case of it: one article instead of a pile (D-DES-033), a fair critical friend (D-DES-037, D-DES-038), tools on the page (D-DES-039), temporary answers and permanent reflections (D-DES-045), pencil for Marginalia and pen for BK (D-DES-018, D-DES-020). The full statement and its three tests are in [00](00-overview.md#the-foundation-ai-as-a-thinking-partner).
- **Rules out:** auto-concluding features (a generated "what you thought", an automatic rating, a summary that replaces reading), features that wait for instructions where a partner would notice, and anything that blurs Marginalia's hand with BK's.

### D-DES-052: The remaining ladder, the archive home and the topic-search defaults. (Claude, delegated by BK)
- **BK, 2026-10-16:** "You can decide for me on the toherr questions."
- **Order:** finish the reader (2a, 2b), then the front door (3, 3c), then links, the summary and the critical friend (2d, 2e, 2c, 2f), then PDF (3b), then rooms, Notes, settings and motion (4–7). Why: the reader items are small and BK uses them daily; the desk is the core promise and unblocks topic search; the annotation work is the largest and needs S6.
- **Archive:** rung 3 adds a minimal Up next shelf with archive to Library when it removes Up next from the desk, because the desk's rows are the only place archiving exists today. Rung 4 restyles it.
- **Topic search:** respects a chosen time (Q14), offers the shortest article on the topic when nothing fits (Q15), and Library keeps the full list (Q16). "Bookmark" and "add to reader" in the link menu are one action, Save for later (Q17).
- **Re-annotation (BK):** "yeah you can reannotate after we fix the annotation stuff." The unread library is re-annotated once, after rung 2c's annotation changes are live, so existing articles get the new kinds.

### D-DES-053: Every jump inside an article can be undone: a chip returns BK to where he was reading. (BK; design by Claude, delegated)
- **BK, 2026-10-16:** "when i ask or define or whatever, it has references to other paragraphs which when i click take me to that paragraph which I like but then there's no easy simple way to go back to the paragraph I was actually on, I have to scroll there manually."
- **Why:** losing your place is a small exit from reading (D-DES-039). A jump the reader can't undo makes following a reference a cost.
- **Design:** one jump helper for every in-article jump; a stack of up to about five positions; a pencil chip "↩ Back to ¶N" and a key; the entry clears when he returns, by chip or by scrolling. Esc keeps its own job (back to the origin room).

### D-DES-054: Every AI call gets the context its question needs, with the summary as background; the one point and short summary are written at import. (BK)
- **BK, 2026-10-16, on long documents:** "what if someone puts a whole book as a pdf and then we ask, we can't send the whole book in our AI call and even in our annotation calls because we'll overrun the context and the thing will be noisy and expensive anyway."
- **BK, agreeing to per-tool budgets:** "I agree, " and "maybe an addition is that we can also always send the summary if it was generated already because it gives a picture of what the piece is about broadly. Or maybe it's cheaper to just always generate the summary at import  taht way we  alway shave it for the tools. We can open the summary with it collapsed."
- **Found:** annotation cuts at 120,000 characters (`marginaliaContext.ts#L8`); passage tools send up to 120,000 characters (`readingCompanion.ts#L6`). Details in [03 What each tool sees](03-reader.md#what-each-tool-sees).
- **Cheapest form:** the import annotation call writes the one point and short summary, so no extra call; the idea map stays on demand.

### D-DES-055: Books are indexed by section and offered only as the next section. (BK)
- **BK, 2026-10-16:** "Your idea of offering a book chapter, something like chapter 4 of X is great. what I'd add is that when you can't offer me chapter 12 when I've only read chapter 1 even if chapter 12 fits the time. So only offer a chapter if it's the next chapter from what I've read."
- **Consequence:** a book never fits a time window, but its next section might; a section further on is never offered. See [03 Books and long documents](03-reader.md#books-and-long-documents).

### D-DES-056: Spend AI work on what BK will realistically read: 20 minutes or less at import, longer ones three ahead of picking. (BK; the 20-minute line by Claude, delegated)
- **BK, 2026-10-16:** "Thinking about things getting expensive. I think over time this app should learn what I like to read and over time we could annotate ahead of time only things that I would realistically read. Or maybe we annotate all shorter articles, but for longer one, we annotate only when the user clicks 30min then we search and then as we present the UI for the user to choose an article, we start annotating and creating summaries for the first three results and as they click another one we do the next three ahead."
- **BK:** "You can decide for me on the line between short an dlong."
- **The line (Claude):** 20 minutes. Every 5, 10 and 20 minute pick is ready instantly; only 30+ reads, which BK spends longer with anyway, wait on lookahead.
- **Consequence:** long articles become offerable before they're annotated; the post-2c re-annotation covers only the short unread articles.

### D-DES-057: Record how BK reads, from now, and show it back as a mirror, not a scoreboard. (BK)
- **BK, 2026-10-16:** "I really want to collect all kinds of stats, what times I read, what times I read short things vs long things, what topics do I linger on, what words to i ask for definitions on, maybe keep a log of my growing vocabulary (like a personal dictionary) make it look like a dictionary in it's look and formatting and even how I find words), what topics I am interested in. etc what time of day, what day of the week, etc etc etc. so that I can go to a stats page and see all kinds of visual graphics and representations of my reading. This is also useful beyond looking pretty. It can be used to learn over time the things that I will most likely read for the ahead of time annotations and even to suggest rss feeds that I should probably unsubscribe from."
- **Found:** visits, sessions and offer outcomes are already recorded (`readingActivity`, `sessions`, `articleInteractions`); paragraph dwell, topics and a reliable lookup log are not.
- **Why record now:** history can't be filled in later, so recording (rung 2g) ships long before the pictures (rung 5b).
- **Rule:** no streaks or nudges (the thinking partner shows; BK concludes, D-DES-051). BK's explicit 2026-11-02 request supersedes the no-goals restriction only for an optional, editable daily estimated-page goal: 300 words per page, partial newly qualified article text, daily history, a compact reader counter and one quiet acknowledged celebration. It does not authorize reminders, leaderboards or guilt messaging.

### D-DES-058: A personal dictionary of every word BK looks up, laid out and searched like a dictionary. (BK)
- **BK, 2026-10-16:** "maybe keep a log of my growing vocabulary (like a personal dictionary) make it look like a dictionary in it's look and formatting and even how I find words".
- **Rule:** every Define is recorded as a lookup whether or not the answer is kept (D-DES-045), so 2b must ship the lookup log with temporary answers.

### D-DES-059: Topic tags come from a vocabulary that resists growth, seeded from BK's vault. (BK; mechanism by Claude, delegated)
- **BK, 2026-10-16:** "when we auto annotate we generate tags, that could help the quick search later. But autotag generation needs thought so that you don't end up with a million tags. You need a way of saying this is really the same thing and fits into this already existing tag, have some resistance to creating new tags and prefer adding to existing ones unless something earns it. tags would also help with a word cloud or something of the topics I'm interested in."
- **Mechanism:** choose before creating; embedding match onto tags and aliases; new tags start as hidden candidates and need to recur; merges are suggested, never silent. See [02 Tags](02-design-concept.md#tags). Seed: vault tags already imported (`noteChunks.tags`).

### D-DES-060: Stats and the dictionary live in their own room, Your reading, outside the reading path. (BK)
- **BK, 2026-10-16:** "if you put stats and dictionary in the reader even in the notes tab they become a source of distraction."
- **Replaces** D-DES-024's "This week becomes Notes → Your week": Your reading is a fourth room in the header, never linked from the reader or the notes pane.
- **2026-11-02 exception:** the explicitly requested opt-in page-goal counter may appear in the existing reader toolbar. Detailed Stats and goal editing stay in Your reading; no new floating control or focus-taking celebration.

### D-DES-061: Four rooms in the header; settings behind the avatar. (BK)
- **BK, 2026-10-16, answering Q3 and Q4:** yes to four rooms (Desk as the wordmark, Library with Up next, Saved, Loved and Finished shelves, Notes, Your reading) and yes to Sources, Account and Readers behind the avatar menu.
- **Consequence:** D-DES-024 and D-DES-025 are now BK's decisions, with Your reading as the fourth room (D-DES-060). Until rung 5b builds the room, its header link opens today's `/reading` page.

### D-DES-062: Notes opens on a local graph of connected ideas; the list is one click away. (BK; design by Claude, delegated)
- **BK, 2026-10-16:** "The notes page is just a list of notes and risks also becoming that overwhelming pile again. I think it would be nice if there could be like an obsidian graph style of idea map where I can see connections of ideas not just a list of notes an dI can search for an idea or select a starting note and then see the graph of connected ideas and I can click to read the notes and make new ones and reflect an dall. I think that would be better than a list of notes. What do you think ?"
- **BK, answering:** graph first with the list one click away; Obsidian vault notes appear as nodes.
- **Design (Claude):** a local graph, never the whole hairball: one idea in the centre, its closest connections around it and theirs faintly beyond, about 15 nodes at most, laid out with the idea-map legibility rules. Clicking a node recentres. Every edge can say why it exists (meaning, shared tag, same article, a Marginalia connection, or a link BK made by dragging one note onto another); the sentence for an edge is generated only when BK selects it. Nodes keep their hand: BK's notes and marks in pen, kept answers in pencil, articles as print, vault notes as their own kind. Selecting a node opens it beside the graph to read, reply or start a connected note, which joins the graph at once.
- **Assumed (Q18):** with nothing selected, the graph starts on BK's most recent note, with search to start anywhere else.
- **Why:** a list of notes is the pile again (D-DES-033); relating ideas is the thinking a partner should make visible (D-DES-051).

### D-DES-063: Comp approval and the remaining product calls are delegated to Claude for the rest of this run. (BK)
- **BK, 2026-10-16:** "just keep going , keep working decide", when rungs 5c and 7 were waiting on comp approval.
- **Claude approved:** the comps for rungs 2f, 5c and 7 as made.
- **Claude decided:**
  - **Rung 5c:** the tag-merge suggestion sits under Your reading's topics, because that is the one place the whole tag vocabulary is visible and there is no tags page. Keep on a feed suggestion silences it for 90 days; Keep both on a tag pair is permanent for that pair.
  - **Rung 7:** browsers without View Transitions get an instant swap, not the 200 ms fade (S1).
  - **Rung 5b:** the approved comp's opening view replaces the "Your week" rhythm bars and kept-note rows ([05](05-library-notes-week.md#your-week-inside-your-reading)).
  - **Failed annotations:** an article whose first annotation failed is retried when picked or opened, at most twice, and the backfill retries short unread ones (a bulk import on 2026-10-12 failed 213 at once).
- **BK corrects afterwards;** destructive and outward-facing actions still need him.

### D-DES-064: The desk is one column: question, times, slot, search. (BK; layout by Claude, delegated)
- **BK, 2026-10-16:** "it's weird for me to click the time on the right and then select the article on the otherside of the screen on the right. For me that mouse movement across feels weird and wasteful".
- **Decision (Claude):** one centred column about 760 px wide, in this order: date, question, time choices, the slot, the search bar. The pick appears directly below the times just clicked. The phone order is the same.
- **Replaces** the two-column layout in D-DES-021, where the time choices and search sat to the right of the question and slot.
- **Why:** the pointer stays in one place from choosing to picking. A 760 px measure keeps the 4.5 rem question and the 620 px pick text on one axis at 1440.

### D-DES-065: The avatar menu has a theme row. (BK; design by Claude, delegated)
- **BK, 2026-10-16:** "there's no way to change the colro theme on the home page or any other page that's not the reader page".
- **Decision (Claude):** Paper, Sepia, Snow, Dusk, Night, Ink and Auto as swatches in the avatar menu, the same themes and storage as the reader's settings. Choosing one changes the page at once and keeps the menu open.

### D-DES-066: Each mark keeps its own colour; the last colour picked becomes the default. (BK; mechanism by Claude, delegated)
- **BK, 2026-10-16:** "currently you select a highlight color in the settings and all your highlights become like that. I wan tto be able to select the highlight color or pen color when I actually highlight or use the pen, when I select a color that becomes the default till I select another one".
- **Decision:** the selection toolbar offers the four colours beside Highlight and Underline; a pick marks in that colour and becomes the tool's default. Each mark stores its colour (`highlights.color`). Before a default changes, marks saved without a colour are first given the colour they show, so changing the default never repaints existing marks.
- **Why:** colour is part of what the reader meant when they marked; a settings change shouldn't rewrite their past marks.

### D-DES-067: The rooms use 02's 680 px main column, with no side column. (Claude, delegated by BK)
- **BK, 2026-10-17:** "fix all the things", on the remaining audit list, which included 02's 680/320 split for the rooms.
- **Decision:** Library, Notes (list view), Your reading and the settings pages sit in the room frame (1180 px) with their content in one column of 680 px, as 02 says. The Notes map is a canvas, not a column, so it keeps the full frame. There is no 320 px side column.
- **Why:** nothing in the rooms belongs in a side column today, so the split would mean inventing content to fill it. The 680 px column is what 02 specifies, and it keeps lines short at desktop width. It also matches the one-column desk (D-DES-064), which BK chose so the pointer stays on one axis.

### D-DES-068: Annotation reads the first 120,000 characters, and an outline of the sections past them. (Claude, delegated by BK; revised 2026-10-17)
- **Decision:** annotation still sends the article's first 120,000 characters (`convex/lib/marginaliaContext.ts`). When the article is longer, it also gets an outline of the headings past that point, in order, each with its rough length in words (`convex/lib/articleOutline.ts`). The outline is read from the stored HTML's h1 to h3 headings and bounded to 60 headings and about 4,000 characters; when there are more, the listed ones are spread across the rest of the piece. The prompt tells the model that notes anchor only to the text it can see, and the outline is for placing the piece, not for anchors. An article with no headings past the window keeps the single line "[The article continues beyond this point.]". An article within the window gets the same prompt as before. Reading alongside still annotates one section at a time.
- **Why:** the first version left the window as it was, on the grounds that import annotates only articles of 20 minutes or less. That holds for import alone: articles over 20 minutes are deferred (`convex/lib/annotationPolicy.ts`) and annotated later by the same action, so the window does cut them. On 2026-10-17 the owner asked for the margin notes to know the shape of the whole piece. The outline gives that for the cost of a list of headings; the body of later sections is still not sent.
- **Not changed:** `CURRENT_ANNOTATION_VERSION`. Existing margins are not re-annotated, so articles annotated before this change keep the notes they have.
- **History:** first recorded as keeping the 120,000-character window with no outline. Revised on 2026-10-17 at the owner's request.

### D-DES-069: A title the reader types shows as the first card at once; other never-typed topics may take about a second. (Claude, delegated by BK)
- **Decision:** the picker also searches article titles (`titleSearch.matchTitles`, a full-text index on `articles.title`) beside `library/find`. When every typed word of three letters or more starts a word in a title, that article is the first card without waiting for the query to be embedded. `find`'s ranking then follows with that article removed, and a title result that arrives after `find` is dropped, so the first card never swaps. Any other never-seen query still took about 0.8–1.4 s for its first card (D-DES-072 now covers those whose words all appear in one article); repeated queries take about 110–150 ms through the direct call and the query cache (rung 3c).
- **Why:** the first version of this decision accepted the embedding round trip as the provider's cost. The owner asked on 2026-10-17 for it to be fixed for the case the reader can predict, a title they remember. The embedding call can't be made faster with one provider, but a title match needs no embedding.
- **History:** accepted as about a second on 2026-10-16, with speculative embedding while typing rejected as an extra endpoint and spend on half-typed queries. That still holds for topics that match no title. Revised 2026-10-29: D-DES-072 adds a text match for those.

### D-DES-070: The reader toolbar stays visible while reading and shows a compact title once the heading scrolls away. (BK, 2026-10-28)
- **BK, 2026-10-28:** "when i'm in a scrolled down view like this, I'd still like to see the title of the artivle, maybe in a smaller font. I want to still see the nav that has the back button and toher tools"
- **Decision:** the top bar no longer fades on wide screens. It stays visible at every width and scroll position, with its translucent background and blur. Once the article's own heading has scrolled up under the bar (an IntersectionObserver on the heading, with the bar's height as the top inset), the bar shows the title between Back and the tools: one line, truncated, `--ink-soft` at `text-sm`, fading over `--motion-quick` with opacity only. While the heading is on screen the slot is empty. Phones follow the same rule: their bar used to show the title even with the heading on screen, so it appeared twice (BK chose to match them, 2026-10-28). Book parts and Bible readings show the title the page passes to the bar, which is the article's heading.
- **Why:** this reverses the fade confirmed in D-DES-029 (the "toolbar fades while reading" line in [03](03-reader.md#toolbar)). Scrolling down a long article hid the Back button and the title exactly when the reader was deepest in it. The fade bought a clear page at the cost of the two controls the reader most needs there. The pen-colour and no-overlap rules are unchanged: the bar is still translucent, and nothing sits on the text column except the bar itself.
- **Not changed:** the progress line at the top, the "↩ Back to ¶N" chip (it sits in the margin, not under the bar), and the reader's `scroll-padding-top`, which already clears the bar.

### D-DES-071: Passage actions open from the keyboard, show their keys on demand, and Bible readings move by verse. (BK, 2026-10-28)
- **BK, 2026-10-28:** "I can keyboard navigate the paragraphs with j/k, would be nice if there was a keyboard shortcut to bring the context menu that has ask explain etc for the selected passage and then after that if the options on that menu were single key shortcuts. j/k should move one verse at a time for bible readings."
- **Decision:** `Enter` opens Passage actions on the j/k cursor (a paragraph, or a verse in a Bible reading), or on the selection when there is one, and only from the page or the cursor's own block, so links, buttons, notes and fields keep their Enter. While the menu is open each action has a key that acts on the menu's range, not on whatever is selected: `e s d a h p` as everywhere, and `n` Note, `c` Copy, `t` Deep study. These shadow the reader's `n` (Open notes) only while the menu is open, and `j`/`k` close the menu before moving. The colour pickers stay on the pointer and Tab. `Escape` closes the menu and returns focus to the cursor. In a Bible reading j and k step one verse in reading order. The cursor is a text range painted with the CSS Custom Highlight API, so the Bible markup is untouched.
- **Applies D-DES-021 and D-DES-004:** a menu opened from the keyboard shows each action's key beside its label as a quiet keycap, because the reader has just asked the keyboard for it; a menu opened by a pointer selection keeps keys in tooltips and under Alt. Keyboard access stays complete without painting keycaps on every surface, and focus stays quiet: the verse cursor is a tint, not a ring.
- **Why `Enter`:** a focused paragraph has no other Enter action, and links and buttons keep theirs. `m` or `.` would need to be learned; Enter is where a reader already tries first.
- **Not changed:** the menu's look and order for pointer selections, the global letter keys and their paragraph fallback, and Backspace.

### D-DES-072: A topic that names no title shows the best text match as the first card while the query is embedded. (Claude, asked by BK 2026-10-29; for BK to confirm)
- **BK, 2026-10-29:** asked for a quick text-match first card for topics that match no title, shown while the embedding runs, under the same no-swap rule as the title card.
- **Decision:** the picker also runs `titleSearch.matchText` beside `matchTitles` and `library/find`. It searches a new full-text index, `articles.search_content` on `content` (filtered by `userId` and `extractionStatus`), for the signed-in reader's extracted articles only. It reads at most 5 hits (article bodies reach about 900 KB, so 5 stay well under the 16 MiB read limit, and the reads go through the same legacy byte budget as `matchTitles`), drops a second copy of the same URL, and returns `find`'s card fields, unread before started before read.
- **Strength is judged on the server, where the text is:** a hit is returned only when every typed word of three or more letters appears as a whole word in the article's title, excerpt or text, case-insensitive. The words `and the for with from that this into about what how` are ignored, and the last typed word counts as a prefix because it is usually unfinished. Full-text search matches any shared term, so without this rule a one-word overlap would become the first card. The whole query is judged, not the 200 characters sent to the index, and a query with more than 16 qualifying words (Convex's terms per search) gets no text card. Query and article text are normalized to NFC first, so an accented word typed in decomposed form stays one word.
- **Precedence and no swap:** a strong title match always wins. A strong text result is held until the title query for the same text has settled (answered or failed), and is shown only if that produced no strong title match and `find` hasn't landed. The title query reads small records and is the faster of the two, so the hold costs nothing in practice. Whichever card shows first stays: when `find` lands, the card stays first and `find`'s list follows with that article removed; a text result after `find` is dropped. All of it is decided in the one `land` step in `use-topic-search.ts`, and `find` failing still shows the error with Retry.
- **Cost:** no embedding, no AI call, no new endpoint; one more Convex query per uncached search. The extra index is a second search index on `articles` (now `search_title` and `search_content`), and it indexes the full extracted text, so its storage and indexing write cost grow with the size of the library's text. That size is not measured. Convex backfills it on deploy, and every later change to `content` also updates it.
- **Why:** the title card covers a title the reader remembers; most first-time topics name a subject instead, and the embedding is the whole wait. Where every word is in one article, text search finds it without waiting.
- **Not changed:** queries whose words are not all in one article (a paraphrase, a concept the article never names) still wait for the embedding, 0.8–1.4 s. Repeated queries still use the cache.
