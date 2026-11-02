import { type SpokenBlock, splitLeading, splitSpoken } from "./spoken-text";

/** One clip: a block, or one part of a block too long for a single clip. */
export interface QueueItem {
  block: number;
  part: number;
  text: string;
  /** Headings are followed by the longer pause. */
  heading: boolean;
  kind?: SpokenBlock["kind"];
  /** Fractions of this block's spoken parts; within-block following is an estimate. */
  sourceStart: number;
  sourceEnd: number;
}

/** The title item sits before the first paragraph and belongs to no paragraph. */
export const TITLE_BLOCK = -1;
/** The playing item plus this many ahead are kept ready (D-TTS-008). */
export const LOOKAHEAD = 3;
export const MAX_IN_FLIGHT = 2;
export const GAP_MS = 350;
export const GAP_AFTER_HEADING_MS = 700;
const GAP_RESTART_AFTER_SECONDS = 3;

/**
 * The items for a listen that starts at block `start`. Blocks that are skipped
 * (`null`) give none. What is heard first is capped at 300 units so the voice
 * starts quickly (D-TTS-023): the spoken title `intro` when a listen starts from
 * the top, and the first block that will be read at or after `start`, which
 * begins with a lead item. Every other block is packed as usual. Earlier blocks
 * are included, so previous can go back past the start.
 */
export function buildQueue(
  blocks: readonly (SpokenBlock | null)[],
  start: number,
  lang: string,
  intro?: string,
  maxChars?: number,
): QueueItem[] {
  const items: QueueItem[] = [];
  const push = (
    block: number,
    parts: string[],
    heading: boolean,
    kind?: SpokenBlock["kind"],
  ) => {
    const total = parts.reduce((sum, text) => sum + text.length, 0);
    let offset = 0;
    for (const [part, text] of parts.entries()) {
      items.push({
        block,
        part,
        text,
        heading,
        sourceStart: offset / total,
        sourceEnd: (offset + text.length) / total,
        ...(kind ? { kind } : {}),
      });
      offset += text.length;
    }
  };
  // The first thing heard is capped at 300 units: the title when there is one,
  // else the first block that will be read, which may be after a skipped start
  if (start === 0 && intro)
    push(
      TITLE_BLOCK,
      splitLeading(intro, lang, undefined, maxChars),
      true,
      "heading",
    );
  const lead = blocks.findIndex((block, index) => block && index >= start);
  blocks.forEach((block, index) => {
    if (!block) return;
    if (block.kind === "code") {
      // Arbitrary prose cuts lose code indentation and branch context.
      const fits = block.text.length <= (maxChars ?? 2000);
      push(
        index,
        [
          fits
            ? block.text
            : "Code sample. This sample is too long to explain reliably in one spoken passage. The complete code remains on the page. Returning to the article.",
        ],
        false,
        fits ? "code" : "prose",
      );
      return;
    }
    push(
      index,
      index === lead
        ? splitLeading(block.text, lang, undefined, maxChars)
        : splitSpoken(block.text, lang, maxChars),
      block.heading,
      block.kind,
    );
  });
  return items;
}

/** The first item at or after `block`, or `null` when nothing is left to read. */
export function firstItemFrom(
  queue: readonly QueueItem[],
  block: number,
): number | null {
  const found = queue.findIndex((item) => item.block >= block);
  return found === -1 ? null : found;
}

/** The first item of the block after item `index`'s block. */
export function nextBlockItem(
  queue: readonly QueueItem[],
  index: number,
): number | null {
  const block = queue[index]?.block;
  if (block === undefined) return null;
  const found = queue.findIndex((item) => item.block > block);
  return found === -1 ? null : found;
}

/**
 * Previous: past 3 s into a clip it restarts the block, otherwise it goes to
 * the previous block's first item. At the first block it restarts that block.
 */
export function previousItem(
  queue: readonly QueueItem[],
  index: number,
  currentTime: number,
): number {
  const block = queue[index]?.block;
  if (block === undefined) return index;
  const firstOfBlock = queue.findIndex((item) => item.block === block);
  if (currentTime > GAP_RESTART_AFTER_SECONDS || firstOfBlock <= 0)
    return firstOfBlock;
  const before = queue[firstOfBlock - 1].block;
  return queue.findIndex((item) => item.block === before);
}

/** Silence after item `index` ends and before the next one starts. */
export function gapAfter(
  queue: readonly QueueItem[],
  index: number,
  hidden: boolean,
  speed = 1,
): number {
  const here = queue[index];
  const next = queue[index + 1];
  // Parts of one block run on; background timers are throttled, so a hidden page
  // relies on the silence at the ends of the clips (S4)
  if (!here || !next || here.block === next.block || hidden) return 0;
  // Silence shortens with the speech, so a faster listener isn't left waiting
  return (here.heading ? GAP_AFTER_HEADING_MS : GAP_MS) / speed;
}

export type ClipStatus = "pending" | "ready" | "failed";

/**
 * Which items to request now: the playing item first, then up to `LOOKAHEAD`
 * after it, skipping any that already have an entry (so none is requested
 * twice) and stopping at a failure (Retry owns it). `inFlight` counts every
 * request that hasn't settled, including ones a Stop or restart left behind,
 * because an action can't be cancelled; `MAX_IN_FLIGHT` caps them.
 */
export function planFetches(
  length: number,
  playing: number,
  entries: ReadonlyMap<number, ClipStatus>,
  inFlight: number,
): number[] {
  let free = MAX_IN_FLIGHT - inFlight;
  const planned: number[] = [];
  for (let i = playing; i <= playing + LOOKAHEAD && i < length; i++) {
    if (free <= 0) break;
    const status = entries.get(i);
    if (status === "failed") break;
    if (status) continue;
    planned.push(i);
    free -= 1;
  }
  return planned;
}
