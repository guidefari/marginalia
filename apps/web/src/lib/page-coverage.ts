import type { PageCredit } from "@marginalia/backend/reading-activity";
import {
  addCell,
  cellWeights,
  coverageWords,
  emptyCoverage,
  hasCell,
  PAGE_CELL_WORDS,
  type PageGoalSchedule,
  scheduledGoal,
  unionCoverage,
} from "@marginalia/backend/reading-pages";

export type PageCoverageConfig = PageGoalSchedule & {
  sourceId: string;
  coverage: string;
  paragraphWords: number[];
  timeZone: string;
};

/** Virtual text cells, not individual word DOM ranges. Geometry is deliberately approximate. */
export function visiblePageCells(
  rects: readonly { top: number; bottom: number; height: number }[],
  words: readonly number[],
  viewport: number,
) {
  const cells: number[] = [];
  let offset = 0;
  for (let p = 0; p < words.length; p++) {
    const count = Math.ceil(words[p] / PAGE_CELL_WORDS);
    const rect = rects[p];
    if (rect && rect.height > 0) {
      const start = Math.max(0, Math.min(1, (64 - rect.top) / rect.height));
      const end = Math.max(
        0,
        Math.min(1, (viewport - 72 - rect.top) / rect.height),
      );
      for (let cell = 0; cell < count; cell++) {
        const from = (cell * PAGE_CELL_WORDS) / words[p];
        const to = Math.min(words[p], (cell + 1) * PAGE_CELL_WORDS) / words[p];
        if (from >= start && to <= end) cells.push(offset + cell);
      }
    }
    offset += count;
  }
  return cells;
}

export class PageCoverageClock {
  readonly weights: number[];
  private covered: string;
  private visible: number[] = [];
  private exposure = new Map<number, number>();
  private allowance = new Map<number, number>();
  private days = new Map<string, PageCredit>();
  private delivered = new Map<string, string>();
  private currentDay: string | undefined;
  constructor(readonly config: PageCoverageConfig) {
    this.weights = cellWeights(config.paragraphWords);
    this.covered = config.coverage;
  }
  view(cells: number[]) {
    const next = new Set(cells);
    for (const cell of this.exposure.keys())
      if (!next.has(cell)) this.exposure.delete(cell);
    this.visible = cells;
  }
  credit(ms: number, day: string) {
    if (ms <= 0) return;
    // Do not spend yesterday's unfinished allowance against today's duration cap.
    if (this.currentDay !== day) this.allowance.clear();
    this.currentDay = day;
    let sample = this.days.get(day);
    if (!sample) {
      sample = {
        sourceId: this.config.sourceId,
        coverage: emptyCoverage(this.weights.length),
        visualTimeMs: 0,
        timeZone: this.config.timeZone,
        goalWords: scheduledGoal(this.config, day),
      };
      this.days.set(day, sample);
    }
    sample.visualTimeMs += ms;
    // One allowance is consumed in text order, not duplicated for every visible paragraph.
    let budget = (ms * 220) / 60_000;
    for (const cell of this.visible)
      this.exposure.set(cell, (this.exposure.get(cell) ?? 0) + ms);
    for (const cell of this.visible) {
      if (hasCell(this.covered, cell) || (this.exposure.get(cell) ?? 0) < 1000)
        continue;
      const before = this.allowance.get(cell) ?? 0;
      const used = Math.min(budget, this.weights[cell] - before);
      this.allowance.set(cell, before + used);
      budget -= used;
      if (before + used + 0.000001 >= this.weights[cell]) {
        this.covered = addCell(this.covered, cell);
        sample.coverage = addCell(sample.coverage, cell);
        this.allowance.delete(cell);
      }
      if (budget <= 0) break;
    }
  }
  snapshot(day: string) {
    const sample = this.days.get(day);
    return sample ? { ...sample } : undefined;
  }
  acknowledge(day: string, sent: PageCredit) {
    if (!this.days.has(day)) return;
    this.delivered.set(
      day,
      unionCoverage(this.delivered.get(day) ?? "", sent.coverage),
    );
  }
  forgetDay(day: string) {
    this.days.delete(day);
    this.delivered.delete(day);
  }
  pending(day: string) {
    const sample = this.days.get(day);
    if (!sample) return 0;
    const delivered = this.delivered.get(day) ?? "";
    return this.weights.reduce(
      (total, words, cell) =>
        total +
        (hasCell(sample.coverage, cell) && !hasCell(delivered, cell)
          ? words
          : 0),
      0,
    );
  }
  qualified(day: string) {
    return coverageWords(this.days.get(day)?.coverage ?? "", this.weights);
  }
}
