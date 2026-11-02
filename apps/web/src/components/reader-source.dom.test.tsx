// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeGoesBack } from "@/lib/reader-escape";
import { ReaderSource } from "./reader-source";

const mocks = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    total: 12,
    unread: 9,
    unreadInReader: 0,
    all: 10,
    allInReader: 0,
    partial: false,
  }),
  useMutation: () => mocks.remove,
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { feeds: { removalPreview: "preview", remove: "remove" } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const feed = {
  // SAFETY: this branded fixture ID is consumed only by the mocked Convex hooks.
  _id: "feed-1" as Id<"feeds">,
  title: "The Weekly Letter",
  isActive: true,
};
let root: Root;
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
const render = async (source = feed) => {
  await act(async () => root.render(<ReaderSource feed={source} />));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  mocks.remove.mockReset().mockResolvedValue(null);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("reader source", () => {
  it("names the source and links to Sources, without unsubscribing on open", async () => {
    await render();
    const link = document.querySelector("a");
    expect(link?.textContent).toBe(feed.title);
    expect(link?.getAttribute("href")).toBe("/feeds");
    expect(document.body.textContent).toContain("From The Weekly Letter");
    expect(button("Unsubscribe").getAttribute("aria-expanded")).toBe("false");
    await act(async () => button("Unsubscribe").click());
    expect(document.body.textContent).toContain(
      "12 articles stay in your library",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    "keep",
    "unread",
    "all",
  ])("uses the Sources confirmation for the %s choice", async (choice) => {
    await render();
    await act(async () => button("Unsubscribe").click());
    const radio = document.querySelector<HTMLInputElement>(
      `input[value="${choice}"]`,
    )!;
    await act(async () => radio.click());
    await act(async () => button("Remove").click());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
      feedId: feed._id,
      articles: choice,
    });
    expect(button("Unsubscribe").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button("Unsubscribe"));
  });

  it("cancels without changing the source and returns focus", async () => {
    await render();
    await act(async () => button("Unsubscribe").click());
    await act(async () => button("Keep").click());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Unsubscribe"));
  });

  it("keeps a failed unsubscribe open for retry", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("offline"));
    await render();
    await act(async () => button("Unsubscribe").click());
    await act(async () => button("Remove").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't remove the feed",
    );
    expect(button("Unsubscribe").getAttribute("aria-expanded")).toBe("true");
    await act(async () => button("Remove").click());
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it("cannot dismiss a pending removal through the trigger or Escape", async () => {
    let rejectRemoval: (error: Error) => void = () => {};
    mocks.remove.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRemoval = reject;
        }),
    );
    await render();
    await act(async () => button("Unsubscribe").click());
    await act(async () => button("Remove").click());
    const trigger = button("Unsubscribe");
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      trigger.click();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      document
        .querySelector<HTMLInputElement>('input[value="keep"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(button("Removing…")).toBeDefined();
    await act(async () => rejectRemoval(new Error("offline")));
    expect(trigger.getAttribute("aria-disabled")).toBe("false");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't remove the feed",
    );
    await act(async () => button("Remove").click());
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives Escape to the confirmation rather than leaving the article", async () => {
    await render();
    await act(async () => button("Unsubscribe").click());
    expect(
      escapeGoesBack(
        { key: "Escape", defaultPrevented: false, target: document.body },
        { readerPanelOpen: false, selectionActive: false },
        document,
      ),
    ).toBe(false);
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button("Keep").dispatchEvent(escapeEvent));
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(button("Unsubscribe").getAttribute("aria-expanded")).toBe("false");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("also identifies paused subscriptions", async () => {
    await render({ ...feed, isActive: false });
    expect(document.body.textContent).toContain("The Weekly Letter (paused)");
    expect(button("Unsubscribe")).toBeDefined();
  });
});
