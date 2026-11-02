// @vitest-environment happy-dom

import type { FunctionReference } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadingDisplay } from "./reading-display";

interface DisplayFixtures {
  pages?: {
    today: string;
    timeZone: string;
    trackedFrom: string | null;
    visible: boolean;
    pendingGoalDay?: string;
    pendingGoalWords?: number | null;
    history: {
      day: string;
      creditedWords: number;
      goalWords: number | null;
    }[];
  };
  room?: { activeTimeMs: number; readingDays: number; partial: boolean };
  connected: boolean;
  args: (StatsArgs | "skip")[];
}
type StatsArgs = { timeZone: string; today: string; period: "30days" };
const mocks = vi.hoisted(() => {
  const fixtures: DisplayFixtures = { connected: true, args: [] };
  return fixtures;
});

vi.mock("@/components/page-goal", () => ({
  usePageOverview: () => mocks.pages,
}));
vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({ isWebSocketConnected: mocks.connected }),
  useQuery: (_ref: FunctionReference<"query">, args: StatsArgs | "skip") => {
    mocks.args.push(args);
    return args === "skip" ? undefined : mocks.room;
  },
}));

let host: HTMLDivElement;
let root: Root;
const render = () => act(async () => root.render(<ReadingDisplay />));
const text = () => host.textContent ?? "";
const button = (label: string) => {
  const found = [...host.querySelectorAll("button")].find(
    (item) =>
      item.getAttribute("aria-label") === label || item.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.pages = undefined;
  mocks.room = undefined;
  mocks.connected = true;
  mocks.args = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "wakeLock");
  vi.unstubAllGlobals();
});

const data = () => ({
  today: "2026-11-02",
  timeZone: "America/New_York",
  trackedFrom: "2026-11-01",
  visible: true,
  history: [
    { day: "2026-11-01", creditedWords: 600, goalWords: 3000 },
    { day: "2026-11-02", creditedWords: 450, goalWords: 3000 },
  ],
});

it("does not turn loading or missing historical tracking into zero reading", async () => {
  await render();
  expect(mocks.args).toEqual(["skip"]);
  expect(text()).toContain("Loading your progress");
  expect(host.querySelector("progress")).toBeNull();
  mocks.pages = data();
  await render();
  expect(host.querySelectorAll("li")).toHaveLength(7);
  expect(text()).toContain("Not tracked");
  expect(host.querySelectorAll('[data-tracked="false"]')).toHaveLength(5);
  expect(host.querySelector("progress")?.value).toBe(450);
  expect(text()).toContain("8.5 pages to your goal");
  expect(text()).toContain("3.5 pages");
  expect(mocks.args.at(-1)).toEqual({
    timeZone: "America/New_York",
    today: "2026-11-02",
    period: "30days",
  });
});

it("updates live saved totals and goal crossing without counting display time", async () => {
  mocks.pages = data();
  mocks.room = { activeTimeMs: 5_400_000, readingDays: 4, partial: false };
  await render();
  expect(text()).toContain("1 hour 30 minutes");
  mocks.pages = {
    ...data(),
    history: [{ day: "2026-11-02", creditedWords: 3300, goalWords: 3000 }],
  };
  await render();
  expect(text()).toContain("Daily goal reached");
  expect(host.querySelector("progress")?.value).toBe(3000);
  expect(text()).toContain("11 / 10");
  expect(host.querySelector('a[href="/reading"]')?.textContent).toContain(
    "Goals & stats",
  );
});

it("keeps a disabled goal hidden and discloses tomorrow's target and partial stats", async () => {
  mocks.pages = {
    ...data(),
    visible: false,
    pendingGoalDay: "2026-11-03",
    pendingGoalWords: 6000,
  };
  mocks.room = { activeTimeMs: 0, readingDays: 0, partial: true };
  await render();
  expect(text()).toContain("No daily goal set");
  expect(host.querySelector("progress")).toBeNull();
  expect(text()).toContain("From 2026-11-03: 20 pages per day");
  expect(text()).toContain("most recent retained visits");
});

it("does not label cached numbers Live when offline or reconnecting", async () => {
  mocks.pages = data();
  mocks.connected = false;
  await render();
  expect(text()).toContain("Reconnecting");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event("offline")));
  expect(text()).toContain("Offline · saved totals");
});

it("rolls to a new account date without showing yesterday's total or a stale stats date", async () => {
  mocks.pages = data();
  await render();
  mocks.pages = { ...data(), today: "2026-11-03", history: data().history };
  await render();
  expect(host.querySelector("progress")).toBeNull();
  expect(mocks.args.at(-1)).toMatchObject({ today: "2026-11-03" });
  expect(text()).not.toContain("8.5 pages to your goal");
});

it("releases an in-flight screen lock when turned off, and handles unsupported fullscreen", async () => {
  let resolve: (lock: { release: () => Promise<void> }) => void = () => {};
  const release = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await render();
  await act(async () => button("Keep screen on").click());
  await act(async () => button("Keep screen on").click());
  await act(async () => resolve({ release }));
  expect(release).toHaveBeenCalledOnce();
  await act(async () => button("Full screen").click());
  expect(text()).toContain("Full screen isn't available");
});
