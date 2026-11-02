# 07: Decisions

Every decision from the planning session on 2026-10-22, including the options we rejected, so a later agent doesn't argue its way back into one. BK is the decision-maker. The session was one request from BK, followed by research. He asked for a natural voice and delegated the design, so most entries are "Claude, delegated by BK". Where a choice is his to confirm, the entry says "blueprint assumes" and names its question in [08](08-open-questions.md). Change a decision only by adding a new entry that replaces it.

## The arc, briefly

1. BK: "the text to speech on this app is a joke, it's some wacky robotic voice. there's lots of great and cheap and even free sometimes services that can do some brilliant text to speech when i want to listen to an article. Do some research and create a /blueprint for a more sensible TTS please"
2. We read Listen at origin/main `a1c3b87`. It uses the Web Speech API and picks a voice by name pattern, so the voice depends entirely on the device ([01](01-current-state.md)).
3. We looked first at dedicated TTS vendors (ElevenLabs, Google Cloud, Azure, Polly, Cartesia, Inworld). Each would need readers to get a new key.
4. Then we found OpenRouter's speech endpoint, which serves 36 speech models on the key most readers have already saved. That moved the design from "add a TTS vendor" to "use the key we have".
5. OpenAI's own TTS models turned out to shut down on 2027-01-06, so OpenAI-direct speech was dropped.
6. The in-browser Kokoro model was the only truly free option. It is the same voice OpenRouter sells at about three cents an hour, behind an 86 MB or larger download, so it was deferred.
7. We designed playback around one audio element, paragraph-sized clips and a cache, to keep today's follow-along and gain lock-screen controls and speed.
8. We proposed Gemini 3.8 Flash-Lite as the default. BK chose Kokoro instead: "if we use kokoro we'll be paying pennies basicaly. I think we should use that." (D-TTS-021)
9. At Kokoro's price a replay costs a fraction of a cent, so the clip cache no longer pays for itself in rung 1. It moved to rung 3, where the pricier voices arrive (D-TTS-022).

## Decisions

### D-TTS-030: Prepare source-linked spoken text with an LLM before TTS. (BK, 2026-11-02)
- **Replaces:** D-TTS-011's exclusion of code and tables; the source article itself remains authoritative and Marginalia's commentary stays out.
- **BK requested:** reformat and repunctuate written content for listening, including headings, tables, charts, images and code, before passing it to TTS. Research existing work first rather than replacing working infrastructure.
- **Decision:** retain Kokoro, the current player and reader-owned provider routing. Add bounded Quick-model preparation with exact-source prose edits, labeled code explanations, deterministic table labels and source-provided visual descriptions. Missing visual evidence is disclosed, never inferred from a filename or surrounding prose. This is not summary or podcast mode.
- **Bounds and trade-offs:** 1,000 source characters, 2,000 prepared characters, capped model dispatches, separate preparation budget, and explicit Retry on failure. Preparation adds model cost and latency. No new persistent cache or image-fetch service. See [implementation and verification](../narration-preparation.md) and [research](../../research/spoken-narration.md).

### D-TTS-031: Keep the current spoken passage visible, including within long blocks. (BK, 2026-11-02)
- **Extends:** D-TTS-012 and D-TTS-029. Follow starts automatically and tracks progress inside oversized source blocks, not just the start of each paragraph.
- **Decision:** retain a deliberate manual-scroll override and the Follow control, toolbar and pill clearance, and reduced-motion support. Layout changes recheck the current passage instead of being treated as browsing. Natural-voice progress is approximate because Kokoro provides no word timestamps; it never controls completion or clip order.

### D-TTS-001: Listen speaks with a natural synthesized voice, not the device's speech engine. (BK)
- **BK said:** "the text to speech on this app is a joke, it's some wacky robotic voice."
- **Why:** the Web Speech voice varies by device and is often the robotic one. Current models score far above it, for under a dollar an hour ([research](../../research/text-to-speech.md)).

### D-TTS-002: Speech goes through the reader's own saved OpenRouter key. (Claude, delegated by BK)
- **Options rejected:** (a) an app-owned vendor key, because BK would pay for every reader's listening and become the processor for their article text under his own vendor contract; (b) new key slots for ElevenLabs, Google Cloud or Azure, because readers would have to sign up somewhere new for one feature, and OpenRouter already reaches ElevenLabs and Google's best voices.
- **Why:** keys already come "only from that library's own saved credentials" (`convex/lib/router.ts`), and OpenRouter is the provider most readers have. No new account, no new secret, no new billing.
- **Revisit only if:** a reader without OpenRouter asks for natural speech often enough to justify a second path (Q6).

### D-TTS-003: ~~The default voice is Gemini 3.8 Flash-Lite TTS.~~ (Blueprint assumed; Q1)
- **Replaced by D-TTS-021.**
- **Why:** Elo 1251, eighth on the leaderboard, at about $0.59 an hour. That's 84 points below Eleven v4 Turbo, the leader, at about a quarter of its price.
- **Risk:** OpenRouter warns that some models treat the input as a prompt. A narrator that paraphrases is broken. S1 tests verbatim reading; if Flash-Lite fails it, the default moves to Voxtral 3.

### D-TTS-004: The voice catalog is short and curated, like `MODEL_CATALOG`. (Claude, delegated by BK)
- **Decision:** four models: Kokoro (default, D-TTS-021), Gemini 3.8 Flash-Lite (better), Gemini 3.8 Flash (richer), Eleven v4 Turbo (best). Each offers two or three narrator voices chosen in S1.
- **Options rejected:** listing all 36 speech models, because a reader picking a voice wants to hear a few good ones, not compare a catalog; Fish Drama 3, because it is built for directed performances, not narration.

### D-TTS-005: No OpenAI-direct speech. (Claude, delegated by BK)
- **Why:** OpenAI's TTS guide says `gpt-4o-mini-tts`, `tts-1` and `tts-1-hd` shut down on 2027-01-06. Its replacement runs over the Realtime API, a session protocol, which is a lot of machinery for reading paragraphs aloud.
- **Way back:** if OpenAI ships a successor on the plain speech endpoint, add it as another catalog entry behind the same interface.

### D-TTS-006: Speech is synthesized one block at a time, with long blocks split at sentence ends. (Claude, delegated by BK)
- **Decision:** a block is one numbered paragraph (`p`, `li`, heading, `blockquote`, `figcaption`). A block over 2,000 characters is split at sentence boundaries with `Intl.Segmenter`.
- **Options rejected:** (a) one file for the whole article, because the reader would wait minutes for the first word, it breaks paragraph follow-along and skip, and Kokoro and Voxtral take at most 4,096 tokens per request; (b) word-level timing, because OpenRouter returns bare audio with no timestamps.
- **Why:** it keeps today's paragraph highlight and skip, starts in seconds, and a failure costs one paragraph, not the article.

### D-TTS-007: Clips are cached in Convex file storage per reader, article, voice and text. (Claude, delegated by BK)
- **Options rejected:** (a) no cache, because the reader would pay again for every replay and every resumed article; (b) the browser's Cache Storage only, because it doesn't follow the reader from desktop to phone.
- **Retention:** a clip is deleted 30 days after it was last played, and with its article (Q5).
- **When:** rung 3, not rung 1 (D-TTS-022).

### D-TTS-008: Synthesis runs at most three clips ahead of the voice. (Claude, delegated by BK)
- **Option rejected:** synthesizing the whole article when Listen starts, because a reader who stops after a minute would pay for an hour.
- **Why:** three clips is a minute or two of lead, enough to cover a slow request (S3) and make skip forward instant.

### D-TTS-009: Playback uses one `HTMLAudioElement` and the Media Session API. (Claude, delegated by BK)
- **Option rejected:** Web Audio buffer scheduling. It gives gapless joins, which narration doesn't need (a short pause between paragraphs is natural), and it doesn't give the lock-screen, headphone and car controls an audio element gets.
- **Why:** an audio element can keep playing with the phone locked, which the Web Speech API can't (S4 verifies the installed PWA).

### D-TTS-010: Speed runs from 0.8× to 2× through `playbackRate`, kept per browser. (Claude, delegated by BK)
- **Why:** changing speed on the element is instant and costs nothing; resynthesizing at a new speed would cost money and wait. It's an appearance-like preference, so it lives beside the reader settings in browser storage.

### D-TTS-011: The voice reads the print: title and byline, then the prose. Code, tables and Marginalia's notes are never read. (Claude, delegated by BK; Q4)
- **Why:** in "Print, pencil and pen", the narrator lends its voice to the author. Margin notes are pencil and would turn listening into an interruption. Code and tables don't survive being spoken. Footnote markers and bare URLs are cleaned so the voice never says "bracket twelve" or a query string.

### D-TTS-012: The page follows the voice until the reader scrolls; then the bar offers Follow. (Claude, delegated by BK)
- **Replaces:** today's behaviour, which scrolls the speaking paragraph into view every time and pulls a reader who scrolled ahead back down.

### D-TTS-013: The device voice remains only as a named fallback, never a silent switch. (Blueprint assumes; Q3)
- **Why:** with no OpenRouter key, the device voice is better than nothing. Switching to it silently after a failure would bring back exactly the voice BK called a joke, without telling him.

### D-TTS-014: The voice picker shows each voice's cost per hour of listening. (Claude, delegated by BK)
- **Why:** the reader pays on their own key, and "$0.59 an hour" means more to a listener than a price per million characters.

### D-TTS-015: Speech requests ask OpenRouter for providers that don't collect data. (Claude, delegated by BK)
- **Decision:** send `provider: { data_collection: "deny" }`. If no provider for the chosen model qualifies, show that in the picker rather than drop the setting.
- **Why:** articles can be private documents (PDF imports, Reader saves). The setting costs nothing when a provider complies.

### D-TTS-016: Speech gets its own per-reader rate budget. (Claude, delegated by BK)
- **Decision:** a `speech` entry in `READER_LIMITS`, 60 clips a minute.
- **Why:** the `ai` budget (30 a minute) is shared with annotations and answers. Fast skipping at 2× could otherwise starve them, or be starved.

### D-TTS-017: In-browser Kokoro is deferred, not rejected. (Claude, delegated by BK)
- **Why:** it's free and private, but it means a first download of 86 MB or more, uneven WebGPU on phones, and the same voice OpenRouter sells for about three cents an hour.
- **Revisit only if:** readers without a key need natural speech, or offline listening becomes a goal.

### D-TTS-018: The scope stops at listening to the open article. (Claude, delegated by BK)
- **Out:** a listening queue across articles, podcast feeds, downloading for offline, voice cloning, word-by-word highlighting, reading Marginalia's notes aloud. Each is deferred, not rejected. None has a validated problem yet.

### D-TTS-019: Listening keeps counting as reading time. (Kept from the current code.)
- **Why:** `reading-clock.ts` already treats speech as active reading. The new player reports the same `listening` flag.

### D-TTS-020: The feature concept is "Read to you", inside "Print, pencil and pen". (Blueprint assumes; Q2)
- **Why:** it adds no new hand to the page. The narrator lends a voice to the print, the highlighter shows where the voice is, and everything else stays quiet. See [02](02-design-concept.md).

### D-TTS-021: The default voice is Kokoro. (BK; replaces D-TTS-003)
- **BK said:** "if we use kokoro we'll be paying pennies basicaly. I think we should use that."
- **Why:** about $0.03 an hour of listening ($0.62 per million characters on OpenRouter), against about $0.59 for Gemini 3.8 Flash-Lite. Ten hours a month costs about 30 cents.
- **Trade-off accepted:** Kokoro is 57th on the leaderboard (Elo 1065, against 1251 for Flash-Lite). It's a natural voice, a long way from the device voice, but plainer than the top models. Readers who want more pick a richer voice in rung 3.
- **Gained:** Kokoro is a plain text-to-speech model, not a prompted one, so the risk of it paraphrasing the article is much lower. It takes no `instructions`.
- **Way back:** if S1 shows no Kokoro voice BK would listen to for an hour, raise it with him before rung 1 rather than switching the default.

### D-TTS-022: Rung 1 has no clip cache; the action returns the audio directly. (Claude, delegated by BK; follows from D-TTS-021)
- **Decision:** in rung 1, `speech.clip` returns the MP3 bytes (`v.bytes()`) and stores nothing. The `speechClips` table, its storage, the cache query and the retention job (D-TTS-007) arrive in rung 3 with the pricier voices.
- **Why:** with Kokoro, a cached replay saves a fraction of a cent. The cache is a table, stored files, a cron, deletion paths and storage budgeting, which costs more to build and run than it saves. For voices at $0.59–$2.16 an hour it pays for itself again.
- **Limit that makes it safe:** a 2,000-character clip is about two minutes of audio, roughly 1 MB at 64 kbps, well under Convex's 16 MiB return limit.

### D-TTS-023: The first item of a listen is a short lead. (S3 spike, 2026-10-22)
- **Decision:** the first item is at most 300 characters, split at sentence, then comma, then space. It is the leading sentences of the first block that will be read, at or after the start, that fit; a first sentence longer than 300 is cut at its last comma, else its last space. The rest follows as its next item or items, and nothing is dropped. Other blocks use the normal packing of at most 2,000 characters.
- **Why:** S3 measured Kokoro through OpenRouter from the UK: 300 characters took 0.9–1.4 s, 450–550 characters 1.1–2.7 s, 2,000 characters 3.8–4.2 s. Time to first sound is the clip time of the first item, and the target is about 2 s.
- **Cost:** the starting block is split differently from how it would be on a later listen, which matters for the clip cache from rung 3 (a worse cache key on that block only).

### D-TTS-024: The default voice is Kokoro Heart, and readers choose among Kokoro voices in Settings. (BK, 2026-10-22)
- **BK said:** "default voice is heart. but you can put voice seleection settings in settings"
- **Decision:** the default is `af_heart` ("Kokoro · Heart"), picked by ear from the eight S1 samples ([spike](../../research/spikes/2026-10-22-kokoro.md)). Choosing a voice moves forward to rung 1b, as a Kokoro-only list in Settings › Listening with ▶ samples. It needs no cache, because every Kokoro voice costs the same few cents an hour (D-TTS-022).
- **Changes:** rung 3 no longer carries voice choice. It's only the pricier models and the clip cache they need, and it waits for a reason to want a richer voice than Kokoro (D-TTS-018).

### D-TTS-025: The rung 1 Listen bar follows the approved comp, with a 30% preparing wash. (BK, 2026-10-22)
- **Decision:** BK approved the rung 1 comp (design gate item 1) with the 30% variant for `--listen-wash-pending`.
- **Why 30%:** at 20% the wash measured only 1.02–1.04:1 against the page on the light themes, so the "it starts where I am" moment barely showed.
- **The comp's other resolutions, now part of the design:** one dot that stays through every state (breathing, dim when paused, terracotta on failure, absent with no key); the pill 20 px above the phone bar in every state; the slow-wait pencil line in the space under the pill, so the pill never moves; a pill-specific terracotta and focus ring for contrast in Sepia and Dusk; and the failed paragraph keeping the preparing wash.

### D-TTS-029: Rung 2 choices the blueprint left open. (Claude, for BK to confirm; 2026-10-29)
- **Speed storage:** `marginalia.listenSpeed` in `localStorage`, not a field of `marginalia:reader-settings`. Reader settings come from the shared `@planetaryescape/reader` package, which would have to learn the field first, and 05 already names this key. A bad or blocked value reads as 1×.
- **Speed and the rate reset:** the element's `playbackRate` goes back to `defaultPlaybackRate` whenever a new `src` loads, so the player sets both, at once on a change and again before every clip starts. The gap between paragraphs is divided by the speed. The device voice uses `utterance.rate` and picks a new speed up from its next paragraph, because a speaking utterance can't change rate.
- **Speed control:** one number button after Next, stepping through 1, 1.2, 1.5, 1.75, 2, 0.8, and back to 1. A speed set between presets by the slider steps up to the next preset. The slider in Settings › Listen stays usable without a key, since the device voice has a speed too.
- **Follow:** one follower serves both voices. The rule: Follow turns off when the page moves somewhere the voice didn't send it. It watches only scrolls of the document (not a contained scroller such as the settings panel) and ignores keys, wheel, touch and pointer events, so it never guesses intent. When the player scrolls it records the start and the target (the position that puts the block at the reading line); while that scroll is in flight (until `scrollend`, until the page has been still for 150 ms, or 1 s) any position between start and target is the player's, and any position outside it, or any move away from the target after reaching it, is the reader's. The recorded target is clamped to what the document can scroll, and a scroll that wouldn't move isn't armed. After it has landed, any document scroll is the reader's. Reduced motion makes the player's scroll one event at the target. Navigation that moves the viewport (j/k, Backspace, `r`, links, arrows, the scrollbar) is caught by position; one that doesn't (a sidenote opening in the margin, a slider drag) leaves Follow on. Accepted costs: a reader's scroll along the voice's own path during its scroll isn't told apart, and a layout shift from scroll anchoring outside the path counts as the reader. The band runs from the fixed toolbar's real bottom edge (safe-area inset included) to the top of the Listen pill or the phone's bottom bar, falling back to 80 px where there is nothing to measure; a block that fits is centred on the reading line (40% down) inside it, a taller one starts just below the toolbar. The follower looks at the current block again one frame after each reveal (the pill mounts after the first look) and on resize, orientation change and visual-viewport resize, as the player's own scroll, without restarting playback; the pill's footprint is measured from `.listen-wrap`, which sits where the pill rests even mid-transition. A viewport change that arrives during the player's own scroll is rechecked once that scroll lands. Where `visualViewport` exists (pinch zoom), visibility and the reading line are computed inside the visible band, intersected with the toolbar and bar clearance. A skip within a listen keeps the reader's choice, so Next doesn't quietly follow again. A new listen follows.
- **Follow in the pill:** a text button with an arrow-down-to-line icon at the left end, before the dot, with a divider. It exists only while not following. The dot stays.
- **Lock-screen artwork:** the first image in the article body that the page has already loaded (`complete`, `naturalWidth > 0`, http(s) `currentSrc`), read when the listen starts. The article's extracted `imageUrl` is not used: it is independent of the article HTML, so it could hand the lock screen a host the page never contacts. A text-only article has no artwork. This keeps rung 2 frontend-only.
- **Background playback:** shape A only. Shape B waits for S4 to show shape A failing.

### D-TTS-028: Voice choice lives in a Listen tab, and a sample pauses Listen. (Claude, assumed for BK to confirm; 2026-10-28)
- **From:** BK's "fix the remaining issues please", with rung 1b the open Listen item.
- **Decision:** the eight S1 Kokoro voices are a radio group in a new **Listen** tab of reading settings. The choice is `userSettings.speechVoice`, so it follows the reader across devices; a stored ID that left the catalog reads as Heart. Play beside each voice, or Space on it, reads the opening (at most 300 characters) of the paragraph being heard, or the one the reader is on. A sample pauses a playing listen, and leaving the tab or closing settings resumes it. A new voice drops the clips ahead and asks for them again; a clip already playing finishes in the old voice, so a long paragraph split into clips can change voice partway, and a current clip that hasn't started yet is asked for again in the new voice. Samples share Listen's two-request cap: a sample waits for a free slot (ahead of Listen's lookahead), one sample request runs at a time, and a press while one runs replaces any waiting one, so trying voices quickly can't pile up paid requests. Headphone or lock-screen Play during a sample stops the sample.
- **Left as is:** switching voices back and forth (A, B, then A) asks again for A's clips ahead, because the player keeps clips by position, not by voice. Each repeat is about a hundredth of a cent and only follows the reader's own change; keying clips by voice would buy nothing they can hear. Found by the seventh review round.
- **Why a tab:** the panel already groups by tab (Look, Text, Answers), and eight voices don't fit inside another tab without crowding it. The Listen toggle stays in Look.
- **Why pause:** two voices at once can't be compared, and resuming on close matches the demo's "close settings while listening: the next paragraph is in Bella".
- **Character text:** the blueprint asked for one or two words per voice written after listening. Nobody has listened to all eight in this change, so each says only what its Kokoro ID states (American or British, woman or man). BK chose to keep accent and speaker (Q7), since the play button is how a reader judges a voice.

### D-TTS-027: While Listen is on, Space pauses and `[` `]` skip, and Media Session ships before rung 2. (Claude, confirmed by BK; 2026-10-28)
- **From:** `docs/issues/listen-keyboard-controls.md`, the QA run's keyboard charter, after BK asked to "fix the remaining issues".
- **Decision:** while a listen is active, Space pauses and resumes, and `[` and `]` go to the previous and next paragraph. Otherwise Space scrolls the page as before and the brackets do nothing in the reader. A focused button keeps its own Space. The keys match what `[` and `]` already mean on the list pages (previous and next tab).
- **Why Space:** it is the pause key in every media player. Paging with Space while listening is the cost; the voice is already moving the page, and Space stops it, which is easy to see and undo.
- **Media Session now:** without handlers the browser's media keys paused the audio element behind the player, so the pill kept saying "Listening" over silence. The handlers in [05](05-player.md#media-session) shipped with this fix in `use-listen-media-session.ts`. The lock-screen checks (S4) and background playback stay in rung 2. The artwork is left out because the reader's article query doesn't return the image.
- **Also:** the pill says "Paused" while paused, and Previous that restarts a paragraph replays its wash (600 ms) so the press shows. The pill now sits next to the toolbar in the DOM, so Tab reaches it before the article instead of after the back matter.

### D-TTS-026: A run keeps every clip it synthesized; only the playing clip has an object URL. (Claude, from verifier round 2, 2026-10-28)
- **Decision:** within one run the player keeps each clip's blob until Stop, restart, a prose or article change or unmount. It mints an object URL when an item starts playing and revokes it when the voice moves on.
- **Why:** the earlier rule revoked clips two blocks behind the voice, which contradicted "never requests an item twice": pressing Previous twice re-synthesized and re-charged a clip already heard. Revoking a URL while keeping its blob frees nothing, so distance-based revocation bought no memory.
- **Cost:** memory grows with what a run has heard, about 0.5 MB per minute at Kokoro's 64 kbps MP3. A book part change starts a new run, so the bound is one article or part.
