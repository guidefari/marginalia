import { z } from "zod";
import { MAX_PAGE_CELLS, unionCoverage } from "./readingPages";

export const pageCreditSchema = z.object({
  sourceId: z.string().min(1).max(100),
  coverage: z
    .string()
    .regex(/^[0-9a-f]*$/)
    .max(Math.ceil(MAX_PAGE_CELLS / 4)),
  visualTimeMs: z
    .number()
    .finite()
    .min(0)
    .max(26 * 60 * 60 * 1000),
  timeZone: z.string().min(1).max(100),
  goalWords: z.number().int().min(300).max(300_000).nullable(),
});
export type PageCredit = z.infer<typeof pageCreditSchema>;
export function mergePageCredit(
  old: PageCredit | undefined,
  next: PageCredit | undefined,
): PageCredit | undefined {
  if (!old) return next;
  if (!next || next.sourceId !== old.sourceId || next.timeZone !== old.timeZone)
    return old;
  return {
    ...old,
    coverage: unionCoverage(old.coverage, next.coverage),
    visualTimeMs: Math.max(old.visualTimeMs, next.visualTimeMs),
  };
}

const DURATION_MAX_MS = 26 * 60 * 60 * 1000;
const duration = z.number().finite().min(0).max(DURATION_MAX_MS);
/** Paragraphs held for under a second are glances, not dwell. */
export const DWELL_MIN_MS = 1000;
/** Keeps a checkpoint under the 32 KB request limit and a row small. */
export const DWELL_MAX_PARAGRAPHS = 300;
const DWELL_KEY = /^[1-9]\d{0,4}$/;

/**
 * Normalizes a paragraph-dwell map: displayed paragraph numbers only, whole
 * milliseconds of at least a second, none above `maxMs` (a paragraph cannot
 * hold more attention than the visit was active), and the longest 300. The
 * result lists paragraphs in order, whatever order they arrived in.
 */
export function capDwell(
  input: Readonly<Record<string, number>> | undefined,
  maxMs: number = DURATION_MAX_MS,
): Record<string, number> | undefined {
  const kept: [number, number][] = [];
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!DWELL_KEY.test(key)) continue;
    const ms = Math.round(Math.min(value, maxMs));
    if (Number.isFinite(ms) && ms >= DWELL_MIN_MS) kept.push([Number(key), ms]);
  }
  if (!kept.length) return undefined;
  kept.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return Object.fromEntries(
    kept
      .slice(0, DWELL_MAX_PARAGRAPHS)
      .sort((a, b) => a[0] - b[0])
      .map(([paragraph, ms]) => [String(paragraph), ms]),
  );
}

/** Cumulative maps combine by taking the larger reading per paragraph, so a repeat or reordering changes nothing. */
export function mergeDwell(
  old: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
  maxMs: number = DURATION_MAX_MS,
): Record<string, number> | undefined {
  const merged = { ...old };
  for (const [key, ms] of Object.entries(next ?? {}))
    merged[key] = Math.max(merged[key] ?? 0, ms);
  return capDwell(merged, maxMs);
}

export const readingCheckpointSchema = z
  .object({
    articleId: z.string().min(1).max(100),
    sessionId: z.string().min(1).max(100).optional(),
    sessionKey: z.string().uuid().optional(),
    requestedMinutes: z.number().finite().positive().max(1440).optional(),
    visitId: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startedAt: z.number().finite().min(0),
    updatedAt: z.number().finite().min(0),
    activeTimeMs: duration,
    visibleTimeMs: duration,
    timeSpentMs: duration,
    maxScrollPercent: z.number().finite().min(0).max(100),
    // Index of the paragraph at the top of the view at the furthest point.
    // A malformed value costs only the paragraph; the percent still restores.
    paragraphIndex: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .optional()
      .catch(undefined),
    annotationsOpened: z.array(z.string().min(1).max(100)).max(128),
    finished: z.boolean().optional(),
    // A malformed map costs only the dwell; the rest of the checkpoint is kept.
    dwell: z.record(z.string(), z.number()).optional().catch(undefined),
    pageCredit: pageCreditSchema.optional().catch(undefined),
  })
  .refine(
    (s) =>
      s.activeTimeMs <= s.visibleTimeMs &&
      s.visibleTimeMs <= s.timeSpentMs &&
      s.timeSpentMs <= s.updatedAt - s.startedAt + 1000,
    "Invalid reading durations",
  );

export type ReadingCheckpoint = z.infer<typeof readingCheckpointSchema>;

// The last paragraph is in view; footers and rounding keep exact 100 unreliable
const END_PERCENT = 95;
// Enough reading time that a skim to the bottom doesn't archive the article
const READ_TIME_SHARE = 0.4;

/** Whether this much reading, across every visit, counts as having read the article. */
export function hasReadArticle(
  reading: { maxScrollPercent: number; activeTimeMs: number },
  estimatedReadMinutes: number,
) {
  return (
    reading.maxScrollPercent >= END_PERCENT &&
    reading.activeTimeMs >= estimatedReadMinutes * 60_000 * READ_TIME_SHARE
  );
}

/**
 * The paragraph to keep with a visit's furthest scroll. It belongs to the
 * percent it was measured at, so a checkpoint that goes further without one
 * clears the old paragraph rather than leaving it pointing short of the place.
 */
export function furthestParagraph(
  old: { maxScrollPercent: number; paragraphIndex?: number } | null,
  next: { maxScrollPercent: number; paragraphIndex?: number },
): number | undefined {
  if (!old || next.maxScrollPercent > old.maxScrollPercent)
    return next.paragraphIndex;
  if (next.maxScrollPercent === old.maxScrollPercent)
    return next.paragraphIndex ?? old.paragraphIndex;
  return old.paragraphIndex;
}

/** The visit that got furthest; its paragraph travels with it. Later visits win ties that carry a paragraph. */
export function furthestPlace(
  visits: readonly {
    maxScrollPercent: number;
    paragraphIndex?: number;
    updatedAt: number;
  }[],
): { percent: number; paragraphIndex?: number } {
  let best: (typeof visits)[number] | undefined;
  for (const v of visits) {
    if (!best || v.maxScrollPercent > best.maxScrollPercent) best = v;
    else if (
      v.maxScrollPercent === best.maxScrollPercent &&
      v.paragraphIndex !== undefined &&
      (best.paragraphIndex === undefined || v.updatedAt > best.updatedAt)
    )
      best = v;
  }
  return best
    ? {
        percent: best.maxScrollPercent,
        ...(best.paragraphIndex !== undefined
          ? { paragraphIndex: best.paragraphIndex }
          : {}),
      }
    : { percent: 0 };
}
