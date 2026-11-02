/** Page equivalents describe text volume, not physical pagination or comprehension. */

export { startOfLocalDay } from "./readingRoom";
export { dayKey } from "./statsPeriod";
export const WORDS_PER_ESTIMATED_PAGE = 300;
export const PAGE_CELL_WORDS = 8;
export const MAX_PAGE_WORDS = 100_000;
export const MAX_PAGE_PARAGRAPHS = 4096;
export const MAX_PAGE_CELLS = 17_000;

export function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

/** Content identity, not a security signature. Both saved prose fields are authoritative. */
export function pageSourceKey(content = "", html = "") {
  let hash = 2166136261;
  const text = `${content}\u0000${html}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `visible-cells-v1:${text.length}:${hash >>> 0}`;
}

export function cellWeights(paragraphWords: readonly number[]) {
  const result: number[] = [];
  for (const words of paragraphWords)
    for (let left = words; left > 0; left -= PAGE_CELL_WORDS)
      result.push(Math.min(PAGE_CELL_WORDS, left));
  return result;
}

/** Hex bitmaps are JSON/beacon safe, and at most 4,250 characters. */
export function emptyCoverage(cells: number) {
  return "0".repeat(Math.ceil(cells / 4));
}
export function hasCell(bitmap: string, cell: number) {
  return Boolean(
    (Number.parseInt(bitmap[Math.floor(cell / 4)] ?? "0", 16) || 0) &
      (1 << (cell % 4)),
  );
}
export function addCell(bitmap: string, cell: number) {
  const index = Math.floor(cell / 4);
  const nibble =
    (Number.parseInt(bitmap[index] ?? "0", 16) || 0) | (1 << (cell % 4));
  return bitmap.slice(0, index) + nibble.toString(16) + bitmap.slice(index + 1);
}
export function unionCoverage(a: string, b: string) {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
    (
      (Number.parseInt(a[i] ?? "0", 16) || 0) |
      (Number.parseInt(b[i] ?? "0", 16) || 0)
    ).toString(16),
  ).join("");
}
export function coverageWords(bitmap: string, weights: readonly number[]) {
  return weights.reduce(
    (sum, words, cell) => sum + (hasCell(bitmap, cell) ? words : 0),
    0,
  );
}
export function validCoverage(bitmap: string, cells: number) {
  return (
    /^[0-9a-f]*$/.test(bitmap) &&
    bitmap.length === Math.ceil(cells / 4) &&
    Array.from(
      { length: bitmap.length * 4 - cells },
      (_, i) => cells + i,
    ).every((cell) => !hasCell(bitmap, cell))
  );
}

export type PageGoalSchedule = {
  goalWords: number | null;
  pendingGoalWords?: number | null;
  pendingGoalDay?: string;
};
export function scheduledGoal(schedule: PageGoalSchedule, day: string) {
  return schedule.pendingGoalDay && day >= schedule.pendingGoalDay
    ? (schedule.pendingGoalWords ?? null)
    : schedule.goalWords;
}
export function formatPages(words: number) {
  if (words > 0 && words < WORDS_PER_ESTIMATED_PAGE / 10) return "<0.1";
  return (words / WORDS_PER_ESTIMATED_PAGE).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
}
