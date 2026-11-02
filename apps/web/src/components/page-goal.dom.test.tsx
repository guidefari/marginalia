// @vitest-environment happy-dom

import { api } from "@marginalia/backend/convex/_generated/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PageGoalCelebration,
  PageGoalTracker,
  ReaderPageGoal,
} from "./page-goal";

vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    readingPages: {
      overview: "overview",
      setGoal: "setGoal",
      initializeDay: "initializeDay",
      claimCelebration: "claimCelebration",
    },
  },
}));

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isLoading: false },
  queries: vi.fn(),
  data: {
    today: "2026-11-02",
    timeZone: "UTC",
    trackedFrom: "2026-11-02",
    visible: true,
    goalWords: 3000,
    pendingGoalWords: 3000,
    pendingGoalDay: "2026-11-03",
    history: [
      {
        day: "2026-11-02",
        creditedWords: 2992,
        goalWords: 3000,
        achievedAt: undefined as number | undefined,
        presentedAt: undefined as number | undefined,
      },
    ],
  },
  save: vi.fn(async (_args: unknown) => null),
  initialize: vi.fn(async () => null),
  claim: vi.fn(async () => true),
  toast: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useQuery: (_reference: unknown, args: unknown) => {
    state.queries(args);
    if (args === "skip") return undefined;
    if (!state.auth.isAuthenticated || state.auth.isLoading)
      throw new Error("Protected query started before authentication");
    return state.data;
  },
  useMutation: (reference: unknown) =>
    reference === api.readingPages.setGoal
      ? state.save
      : reference === api.readingPages.claimCelebration
        ? state.claim
        : state.initialize,
}));
vi.mock("sonner", () => ({ toast: { success: state.toast } }));
vi.mock("./reading-room/use-local-today", () => ({
  useLocalToday: () => "2026-11-02",
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  state.auth = { isAuthenticated: true, isLoading: false };
  state.queries.mockClear();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  state.save.mockReset();
  state.save.mockResolvedValue(null);
  state.claim.mockReset();
  state.claim.mockResolvedValue(true);
  state.toast.mockClear();
  state.initialize.mockClear();
  state.data = {
    ...state.data,
    visible: true,
    history: [
      {
        day: "2026-11-02",
        creditedWords: 2992,
        goalWords: 3000,
        achievedAt: undefined,
        presentedAt: undefined,
      },
    ],
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async (node: React.ReactNode) =>
  act(async () => root.render(node));
const click = async (text: string) =>
  act(async () => {
    const button = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === text,
    );
    if (!button) throw new Error(`Missing ${text}`);
    button.click();
  });

describe("daily page goal surfaces", () => {
  it.each([
    { isAuthenticated: false, isLoading: false },
    { isAuthenticated: false, isLoading: true },
    { isAuthenticated: true, isLoading: true },
  ])("keeps public initial content free of protected queries and initialization during auth state %j", async (auth) => {
    state.auth = auth;
    state.data = { ...state.data, history: [] };
    await render(
      <>
        <p>Public legal or help content</p>
        <PageGoalCelebration />
      </>,
    );
    expect(host.textContent).toBe("Public legal or help content");
    expect(state.queries.mock.calls.length).toBeGreaterThan(0);
    expect(state.queries.mock.calls.every(([args]) => args === "skip")).toBe(
      true,
    );
    expect(state.initialize).not.toHaveBeenCalled();
    expect(state.claim).not.toHaveBeenCalled();
  });
  it("subscribes and initializes the day normally once authenticated", async () => {
    state.data = { ...state.data, history: [] };
    await render(<PageGoalCelebration />);
    expect(state.queries).toHaveBeenCalledWith({
      timeZone: "UTC",
      today: "2026-11-02",
      days: 1,
    });
    expect(state.initialize).toHaveBeenCalledExactlyOnceWith({
      timeZone: "UTC",
    });
    expect(state.claim).not.toHaveBeenCalled();
  });
  it("does not carry an achievement transition across sign-out and subsequent hydration", async () => {
    await render(<PageGoalCelebration />);
    state.auth = { isAuthenticated: false, isLoading: false };
    await render(<PageGoalCelebration />);
    state.data = {
      ...state.data,
      history: [
        { ...state.data.history[0], creditedWords: 3000, achievedAt: 1 },
      ],
    };
    state.auth = { isAuthenticated: true, isLoading: false };
    await render(<PageGoalCelebration />);
    expect(state.claim).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });
  it("does not celebrate optimistic rounding; celebrates an acknowledged crossing once without taking focus", async () => {
    await render(
      <>
        <PageGoalCelebration />
        <ReaderPageGoal pendingWords={8} savingError={false} />
      </>,
    );
    expect(host.textContent).toContain("Saving");
    expect(host.textContent).not.toContain("Goal reached");
    expect(state.claim).not.toHaveBeenCalled();
    const focus = document.createElement("button");
    document.body.append(focus);
    focus.focus();
    state.data = {
      ...state.data,
      history: [
        { ...state.data.history[0], creditedWords: 3000, achievedAt: 1 },
      ],
    };
    await render(
      <>
        <PageGoalCelebration />
        <ReaderPageGoal pendingWords={0} savingError={false} />
      </>,
    );
    expect(state.claim).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Goal reached");
    expect(document.activeElement).toBe(focus);
    await render(
      <>
        <PageGoalCelebration />
        <ReaderPageGoal pendingWords={0} savingError={false} />
      </>,
    );
    expect(state.toast).toHaveBeenCalledTimes(1);
    focus.remove();
  });
  it("renders existing achievements quietly on hydration and honors a lost concurrent claim", async () => {
    state.data = {
      ...state.data,
      history: [
        { ...state.data.history[0], creditedWords: 3000, achievedAt: 1 },
      ],
    };
    await render(<PageGoalCelebration />);
    expect(state.claim).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });
  it("shows exact history independently of other Stats reports and preserves untracked dates", async () => {
    await render(<PageGoalTracker days={3} />);
    expect(host.textContent).toContain("300 words");
    expect(host.textContent).toContain("Not tracked");
    expect(host.querySelectorAll("li")).toHaveLength(3);
    expect(host.querySelector("progress")?.getAttribute("value")).toBe("2992");
    await click("Edit daily goal");
    expect(host.querySelector("input")?.getAttribute("min")).toBe("1");
    await click("Turn off");
    expect(state.save).toHaveBeenCalledWith({ pages: null, timeZone: "UTC" });
  });
  it("keeps an unsuccessful disable in place and retries disabling, not the numeric editor value", async () => {
    state.save.mockRejectedValueOnce(new Error("offline"));
    await render(<PageGoalTracker days={3} />);
    await click("Edit daily goal");
    await click("Turn off");
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "not saved",
    );
    await click("Retry");
    expect(state.save.mock.calls.map(([args]) => args)).toEqual([
      { pages: null, timeZone: "UTC" },
      { pages: null, timeZone: "UTC" },
    ]);
  });
});
