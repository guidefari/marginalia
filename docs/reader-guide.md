# Read with Marginalia

Use the app as a reading desk: choose a piece, read it with context, and keep the useful marks and thoughts.

## Choose an article

The desk is the home page. It is one column: the date, the question "How much time do you have?", the time choices (5, 10, 20 and 30+ minutes), a slot for your pick and the search. Pick a time, or press `1` to `4`, and a pick appears in the slot with **Read now**, **Another** and **Save for later**. With no time chosen, the slot shows **Continue** for the article in progress, or a loved article that is worth revisiting. Up next is a shelf in Library, not on the desk.

Click the search bar or press `/` to open the floating picker. Type a title, author or description of what you want to read. Results include reasons for their fit; use arrows and Enter or click a result. Escape closes the picker.

Suggestions never include something you've read. An article leaves Up next and the time choices when you press **Done** at its end, when you scroll to the end (95%) after at least 40% of its estimated time spent actively reading across all your visits, or when you archive it in Readwise Reader. To dismiss one without reading it, use the archive button on its Up next row in Library (or `x`); the toast offers Undo. To put a finished article back, press **Mark unread**. It sits beside **Done** at the end of a finished article and in the reader's **More actions** menu; on a phone it also replaces Done in the bottom bar.

Paste an `http`/`https` article URL into the same picker to import it. Extraction and annotation can take time; importing a URL does not guarantee its publisher exposes readable content.

Extracted articles remain in Library's **Up next** shelf and the desk's time choices when you have no AI provider key. Short articles whose marginalia were skipped are readable too. Missing or empty extractions stay out of these choices; books keep their separate reading flow. Open an article to read it without adding a key.

## Read and keep context

Open a piece to enter the separate reader. Select a passage to open its menu: Ask, Explain, Simplify, Define, Highlight, Underline (the pen mark), Note and Copy. Choosing a mark that's already on the passage removes it. **Ask** turns the menu into a question field; toggle **Web** to let the model search, pick **Quick** or **Deep**, and press Enter to send or Escape to close. **Define** gives a dictionary-style meaning, the sense used in this passage, useful etymology when known, and substitute words or phrases that fit the sentence. Select the word or phrase you want to define, then choose **Define** or press `d`. Definitions use the same answer-length, depth and optional web settings as other companion answers; they are AI assistance, not a verified dictionary source. Saved definitions can be reopened and followed up like other conversations. A reopened answer highlights the very words you selected, even when they appear more than once in the paragraph. Where a passage has several answers, each tap on it opens the next one, and a tap on the last one open closes it. With the keyboard, `j`/`k` move between paragraphs and passage actions use the current paragraph if nothing is selected. `Enter` opens the same menu on the paragraph at the cursor, or on a selection if there is one, and shows each action's key beside its label. While the menu is open, `e` Explain, `s` Simplify, `d` Define, `a` Ask, `h` Highlight, `p` Underline, `n` Note, `c` Copy and, in a Bible reading with Deep study on, `t` Deep study run on the menu's passage. `Escape` closes it and returns to the cursor. The colour pickers stay on the pointer and Tab. In a Bible reading `j`/`k` move one verse at a time instead: the verse's text, even where it runs across several lines or paragraphs, is tinted quietly, the page scrolls so its start sits near the middle, a screen reader hears "Psalms 23:4" and the verse, and `e`, `s`, `d`, `a`, `h`, `p`, `o` and `Enter` act on that verse. Clicking in the text drops the verse cursor.

Annotations provide cross-references, context, tensions and questions. A connection is a starting point, not verified evidence. Follow its sources and compare it to the original article. Summary and idea-map controls give a second view without replacing the article.

On a Bible passage, select text and choose **Deep study**. The study records the containing verses and WEB source identity, not licensed display text. Reopen results through **Bible tools → Saved deep studies**; history is read-only. Findings can be empty, partial or insufficient when evidence does not support a conclusion. **Retry study** and **Refresh study** explicitly request another run. A changed source requires a new selection and run.

The article and answer panes scroll independently on a wide screen. Below 1024px, the answer opens in a full-width protected-focus pane with **Back to passage**. The reader font and size remain in use, with a minimum of 18px on desktop and 16px on phones. Short annotations stay beside their passage. Notes save before a pane switch; if saving fails, the draft stays open. Reading position follows the visible passage block through reflow. A temporary comparison view restores the reader's comparison preference when it closes. The Ask follow-up draft remains available across pane changes and resizing.

You can keep a cited Bible reference from a saved Study finding or an owned active WEB margin note. Keeping records the reference, why it was cited and its source link; it does not fetch the target passage or make a model request. Find saved references in the existing **Library** shelf and remove them there. A kept reference may appear in an eligible Bible recommendation with its reason. It will not open automatically. Article-only discovery and opted-out Bible recommendations do not include Keeps.

Open Notes with `n`. A new editor receives focus immediately. Notes save after a short pause, on blur and before the editor/panel closes. If saving fails, the editor keeps the draft visible with Retry; do not leave the page until it saves. A tab-close warning is best-effort, not offline backup.

Rate the article in the impression panel at its end, with `r`, or from **More actions** in the reader header, where **Love this article** is too. The header itself keeps only Back, reading settings and More actions, so nothing competes with the text. Stars have meaningful labels; impressions can also include quick tags and a short thought. Saved articles form a queue; loved articles can return as revisits.

## Adjust the reader

Open settings with `,`. Choose paper/sepia/snow or dark palettes, or Auto to follow the operating system. Adjust the font, size, spacing, width, alignment, paragraph style, drop cap, pen and highlighter. Appearance preferences are stored in this browser, not synchronized across devices.

Focus mode, paragraph numbers and the annotation map are optional. Listen reads the article aloud from the paragraph at the reading line. With an OpenRouter key saved under **Your account**, it uses a natural voice made through that key, and each paragraph is billed to the key, at roughly three cents an hour of speech. Without a key, Listen offers a choice: add one, or use the device voice, which is your browser's speech synthesis (voices and availability depend on your device). The device voice is never used unless you choose it, and a failed natural voice shows its reason with Retry instead of switching. Choose the voice under **Listen** in reading settings (`,`): eight Kokoro voices, all the same price, each with a play button (or Space on the voice) that reads the start of the paragraph you're on. A sample pauses Listen, which carries on when you leave the tab or close settings. The choice follows your account to other devices, and when you change it mid-listen, the clip playing finishes in the old voice and the next one is in the new voice. A listen from the top starts with the title and author. The pill's dot breathes while the voice is preparing or reading, goes dim when paused and turns terracotta when the voice stops; if one paragraph takes more than four seconds to prepare, a pencil line under the pill says so. Skipping works by paragraph, and pausing mid-sentence resumes mid-sentence with a natural voice. While Listen is on, Space pauses and resumes, `[` and `]` go to the previous and next paragraph, and media keys and headphone buttons do the same; the pill says **Paused** while paused. Previous more than three seconds into a paragraph restarts it, and its highlight fades in again to show it. The pill's controls come straight after the toolbar in Tab order. The page follows the voice until it moves somewhere the voice didn't send it (you scroll, or jump with `j`/`k` or Back); then **Follow** appears at the pill's left end, and pressing it scrolls the speaking paragraph back to the reading line and follows again (the page jumps instead of easing when your device asks for reduced motion). The speed button next to Next steps 1×, 1.2×, 1.5×, 1.75×, 2×, 0.8×; the **Speed** slider in the Listen tab sets any value from 0.8× to 2× in 0.05 steps. Speed applies at once, keeps the voice's pitch, and is remembered in this browser; the device voice picks a new speed up from its next paragraph. The lock screen shows the article's title, author or site, and the first image in the article, when the page has loaded one. Answer length, level, depth and web-search policy influence AI responses. Each reader picks the models for annotations, quick answers and deep answers under **Models** in these settings, from the providers their saved keys reach.

With an AI provider key, Listen prepares passages with your **Quick** AI model before speech, adding that model's charges to the voice cost. It adapts punctuation and headings, reads labeled table cells, explains bounded code samples, and uses source-provided image descriptions. Without an AI key, the device voice uses basic cleanup and announces code instead of explaining it. Missing visual evidence is announced, not guessed. Follow also advances within long passages; natural-voice movement is approximate, not word-timed. See [preparing articles for listening](listen/narration-preparation.md) for limits and failures.

## Main navigation

The header has four rooms. **Marginalia** (the wordmark) opens the desk, the page where you choose what to read next. The current room is underlined.

- **Library:** ask questions across your articles, and browse shelves in the URL (`?shelf=`): **Up next** (unread, with archive), **Saved** (articles you queued), **Loved** and **Finished** (your impressions, with stars and what stayed with you). `/saved` opens the Saved shelf.
- **Notes:** revisit saved notes and follow them back to the source article.
- **Your reading:** recent reading, time, engagement and reflections. Its article activity list separates your highlights, underlines and notes from distinct AI margin notes opened during visits, using the same month, 30-day and 90-day choices as the rest of the page. Note dates use creation time, so autosaving an old note does not make it new. Imported Readwise marks are shown separately; their dates are import dates because the original mark dates are not retained. High mark counts describe activity, including disagreement, and do not mean you liked an article. Reports can be partial when their bounded data limit is reached and show at most 30 articles. They use retained records: deleting a mark, note, AI margin note or article removes it from the report.

The avatar at the right of the header opens the account menu:

- Your email, whether you own this library, and one line of source status. When a source fails, the avatar shows a small red dot and the line says what failed.
- **Sources:** add feeds, import OPML, pause subscriptions and manage Readwise Reader sync. A new feed is fetched on the next 30-minute poll, or straight away with **Check now**, and brings in at most its three newest posts from the last 30 days. Later checks also skip posts older than 30 days, so resuming a quiet feed won't import its archive. Feeds without usable dates contribute only their first three entries per check. Posts you already have from Reader or a pasted URL aren't added twice. **Check now** clears the previous errors while feeds wait or run. A progress strip stays visible as you scroll, and each feed shows whether it is waiting or being checked. The bar shimmers until the total is known, then fills from the real count. A failed check shows its new error beside the feed. Removing a feed asks what to do with its articles: keep them, remove the ones you never opened, or remove all of them. Articles with your highlights or notes always stay. Removed articles that are also in Readwise Reader are deleted there too.
- **Readers** (owner only): approve access requests, copy invite links and disable readers. The menu shows how many requests are waiting.
- **Account:** sign-in methods, AI provider keys, connected apps, touch feedback and account deletion.
- **Install app**, **Keyboard shortcuts** (`?`) and **About Marginalia**, which links to the source repository.

The menu opens with Enter or Space, moves with the arrow keys, and closes with Escape, which returns focus to the avatar.

Settings pages keep the desk frame, so the header stays in place. Longer content scrolls below the header; mobile navigation stays at the bottom.

## Keyboard reference

Press `?` for the current shortcut sheet. Single-key shortcuts pause while typing and when a modal is active.

| Where | Keys | Action |
| --- | --- | --- |
| Everywhere | `g d` or `g h`, `g l`, `g n`, `g r` or `g w`, `g s` | Desk, Library, Notes, Your reading, Saved shelf |
| Everywhere | `/`, `Escape` | Search (the desk's bar, or the page's own search), close the active card, panel or menu |
| Desk | `/`, `↑`/`↓`, `Enter` | Open finder, move through live results, open the selected result |
| Desk | `f`, `1`–`4`, `c`, `Escape` | Cycle source, choose a time, continue reading, clear the chosen time |
| Desk, with a pick | `Enter` or `o`, `n` or `→`, `←`, `s` | Read now, another pick, previous pick, save for later |
| Lists | `j`/`k`, `Enter` | Move through rows (arrows too, once a row has focus) and open one |
| Library | `[`/`]` or `←`/`→` | Previous and next shelf |
| Library, Up next | `x`, `s`, `u` | Archive, save or unsave, undo the last archive |
| Library, Saved | `s` | Remove from saved (asks first) |
| Notes | `[`, `]` | Map view, list view |
| Reader | `j`/`k`, `Enter`, `e`, `s`, `d`, `a` | Paragraph navigation (verse in a Bible reading), open Passage actions on the cursor, Explain, Simplify, Define, Ask |
| Reader | `h`, `p`, `o` | Highlight, underline (pen-mark), open the note/conversation on the paragraph or verse |
| Reader, Passage actions open | `n`, `c`, `t`, `Escape` | Add note, Copy, Deep study, close (`n` shadows Open notes only while the menu is open) |
| Reader | `/`, `r`, `u`, `n`, `,`, `l` | Article question, rate, summary, notes, settings, listen |
| Reader, while listening | `Space`, `[`, `]` | Pause or resume, previous paragraph, next paragraph (Space scrolls when Listen is off) |
| Reader | `Backspace`, `Escape` | Back to where you were, back to the room you came from |
| Library | `/` | Focus the Library question input |

Keyboard shortcut badges can be hidden from the sheet. Native Tab navigation remains available. AI and content loading require a connection; consult [limitations](limitations.md) before relying on this app for offline reading or confidential material.
