// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAnswers,
  isRefreshOf,
  leaveArticle,
  readAnswers,
  type StoredAnswer,
  stayOnArticle,
  writeAnswers,
} from "./companion-session";

const answer: StoredAnswer = {
  id: "x",
  mode: "define",
  selection: "tarn",
  paragraphIndex: 1,
  turns: [{ role: "assistant", content: "A lake." }],
  model: null,
};

describe("isRefreshOf", () => {
  const entry = (
    type: PerformanceNavigationTiming["type"],
    path: string,
  ): Pick<PerformanceNavigationTiming, "type" | "name"> => ({
    type,
    name: `https://example.com${path}?session=s1`,
  });
  it("is true only for a reload of that article's own address", () => {
    expect(isRefreshOf("a1", entry("reload", "/read/a1"))).toBe(true);
    // A book's answers are filed under its id and part, the address by id alone
    expect(isRefreshOf("a1:3", entry("reload", "/read/a1?unit=3"))).toBe(true);
    expect(isRefreshOf("a1:3", entry("reload", "/read/b2?unit=3"))).toBe(false);
    expect(isRefreshOf("a1", entry("reload", "/read/a1/"))).toBe(true);
  });
  it("is false for any other way of arriving, or another address", () => {
    expect(isRefreshOf("a1", entry("navigate", "/read/a1"))).toBe(false);
    expect(isRefreshOf("a1", entry("back_forward", "/read/a1"))).toBe(false);
    expect(isRefreshOf("a1", entry("reload", "/read/a2"))).toBe(false);
    expect(isRefreshOf("a1", entry("reload", "/desk"))).toBe(false);
    expect(isRefreshOf("a1", undefined)).toBe(false);
    expect(isRefreshOf("a1", { type: "reload", name: "nonsense" })).toBe(false);
  });
});

describe("session storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("keeps each article's answers apart", () => {
    writeAnswers("a1", [answer]);
    expect(readAnswers("a1")).toHaveLength(1);
    expect(readAnswers("a2")).toEqual([]);
  });
  it("drops entries that are not answers", () => {
    sessionStorage.setItem(
      "marginalia:answers:a1",
      JSON.stringify([answer, { id: 1 }, { ...answer, mode: "other" }, null]),
    );
    expect(readAnswers("a1")).toHaveLength(1);
  });
  it("removes the key when there is nothing left to hold", () => {
    writeAnswers("a1", [answer]);
    writeAnswers("a1", []);
    expect(sessionStorage.getItem("marginalia:answers:a1")).toBeNull();
  });
  it("clears on leaving, but not when the reader comes straight back", () => {
    writeAnswers("a1", [answer]);
    leaveArticle("a1");
    stayOnArticle("a1");
    vi.runAllTimers();
    expect(readAnswers("a1")).toHaveLength(1);
    leaveArticle("a1");
    vi.runAllTimers();
    expect(readAnswers("a1")).toEqual([]);
    clearAnswers("a1");
  });
});
