# Prepare an article for listening

Open an article and choose **Listen**. Each passage is prepared by your Quick AI model before Kokoro reads it. The page keeps the source passage visible while the voice advances. The original article, paragraph numbers, quotes and saved reading position are unchanged.

## What you hear

- Headings have closing punctuation and a longer pause before their prose. Abbreviations and punctuation can be adapted without replacing the author's argument with a summary.
- Simple tables are read as labeled cells. Blank cells stay distinct from zero. Merged or grouped tables announce that their complete header relationships could not be recovered.
- Complete code samples of at most 1,000 UTF-16 units receive a labeled spoken explanation. Longer samples announce the limitation rather than explaining context-free fragments. Exact code remains on the page; an explanation is not an exact technical reading of every token.
- Informative images use source-provided alternatives and descriptions. Captions remain in reading order. Decoration with empty alt text is ignored. Missing visual evidence is announced rather than invented.

The first release does not fetch image pixels, reconstruct missing PDF figures, infer chart trends from neighboring prose, or provide verified mathematical speech. A missing-image notice is a disclosed gap, not an equivalent description of the visual.

## Follow the voice

Following starts automatically. The current passage stays between the reader toolbar and listening controls. Oversized passages advance within the block rather than stopping at its first line. Kokoro does not return word timestamps: movement within a natural-voice clip is estimated from elapsed time and source length, not word-aligned. Device voices use boundary events when the browser provides them.

Deliberately scroll elsewhere to browse independently; **Follow** brings you back. Resizing, rotating, returning to the tab and image loading recheck visibility without restarting audio. Reduced-motion settings disable smooth scrolling.

## Keys, costs and failures

Natural voices still use your saved OpenRouter key. Preparation uses your configured **Quick** model and adds that model's provider charges. OpenRouter preparation and speech requests require providers that deny data collection. A ChatGPT-plan Quick model is refused because its adapter cannot enforce the output cap; choose a capped API-key model in **Your account**.

The device voice uses the same preparation when you have an AI provider. With no AI key it uses basic cleanup and source-provided visual descriptions; code gets a notice instead of an AI explanation. It is not silently substituted for a failed natural voice.

If preparation fails, the voice stops at the source passage and offers **Retry**. It does not synthesize an unchecked rewrite or quietly read raw markup. Stop drops late results and prevents synthesis after an outstanding preparation finishes.

## Implementation boundaries

| Stage | Source of truth |
| --- | --- |
| Source inventory and visual alternatives | `apps/web/src/lib/spoken-text.ts` |
| Source-mapped chunking | `apps/web/src/lib/listen-queue.ts` |
| Authenticated HTTP and bounded in-memory reuse | `apps/web/src/lib/narration-preparation.ts` |
| Public preparation action | `packages/backend/convex/narration.ts` |
| Preparation policy, prompt and validators | `packages/backend/convex/lib/narration.ts` |
| Speech provider and MP3 delivery | Existing `packages/backend/convex/speech.ts` |
| Viewport following | `apps/web/src/lib/listen-follow.ts` |

Preparation accepts at most 1,000 UTF-16 units and returns at most 2,000. The existing player caps lookahead and unsettled work, including preparation followed by synthesis. Preparation has a separate per-reader rate budget, explicit output and time caps, and no automatic domain-repair loop. Ordinary prose uses exact-source edits; code explanations have additional checks but still need semantic evaluation.

Prepared text is held only in a bounded, session-keyed memory cache. There is no narration database, persisted audio cache, schema migration or new speech service. Ownership is checked before provider work and again before the result is returned. As with the existing speech action, authenticated clients supply their own displayed passage; this is not a server-certified canonical extraction.

## Verify changes

Run from the repo root:

```sh
bun run check
bun run build
git diff --check
```

The `narration-*` suites cover source inventory, source-to-speech ordering, preparation before synthesis, numeric fidelity, cancellation, cache isolation and long-block following. Existing Listen suites cover playback, speed, samples, retry, skip and media controls. A passing fixture is not proof that every model explanation is faithful or that physical-phone background playback works.

For a real-browser layout check, run `bun scripts/listen-follow-fixture.ts` and open `http://127.0.0.1:3119/`. At desktop and mobile widths, choose Start and Advance; `window.viewportEvidence()` should report a point between `toolbarBottom` and `pillTop`. Manual scrolling should set `following` false; Follow should restore it. This fixture imports the production follower but does not play audio.

`packages/backend/scripts/evaluate-narration.ts` exports `evaluateNarration(targets, outputPath, fixtureName?)` for a private authenticated harness supplying the reader's existing Quick chain. It is not a standalone credential loader. Do not commit target objects, provider keys or session identities with evaluation reports.

Read the [research](../research/spoken-narration.md) for the reuse decision and source links. The reusable global skill is `~/.dotfiles/.skills/spoken-narration/SKILL.md`; it is not an application runtime dependency.
