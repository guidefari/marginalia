// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeskRoute, { DOUBLE_CHOICE_MS } from "@/components/desk/desk";
import { SKELETON_DELAY_MS } from "@/components/desk/desk-pick";
import { markFinished, rememberedTitle } from "@/lib/title-handoff";
import { ALT_HOLD_MS, AltHintProvider } from "@/lib/use-alt-hint";
import { SAVED_MS } from "@/lib/use-timed-flag";

// Motion completes in the mock; actions no longer wait on a wall-clock cooldown.
const SETTLE_MS = 0;

type Pending = {
  name: string;
  args: Record<string, unknown>;
  resolve: (value?: unknown) => void;
  reject: (e: Error) => void;
};

const state = vi.hoisted(() => ({
  overview: undefined as unknown,
  pauseMotion: false,
  animations: [] as (() => void)[],
  inProgress: null as unknown,
  resumeReady: true,
  due: [] as unknown[],
  feeds: [] as unknown[],
  readwise: { connected: false } as unknown,
  heads: {} as Record<number, unknown[] | undefined>,
  paged: {
    results: [] as unknown[],
    status: "CanLoadMore" as string,
    loadMore: vi.fn(),
  },
  shortest: null as unknown,
  latestImport: null as unknown,
  failOverview: false,
  search: "",
  push: vi.fn(),
  prewarm: vi.fn(),
  // Each mutation waits until the test settles it, so races can be reproduced
  pending: [] as Pending[],
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server");
  return {
    useConvex: () => ({ prewarmQuery: state.prewarm }),
    useQuery: (fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(fn as never);
      switch (name) {
        case "bible:preferences":
          return { enabled: false, scope: "articles", translation: "web" };
        case "home:counts":
          if (state.failOverview) throw new Error("boom");
          return state.overview;
        case "sessions:getContinue":
          return state.inProgress === undefined
            ? undefined
            : { ready: state.resumeReady, item: state.inProgress };
        case "lovedArticles:getDueForReview":
          return state.due;
        case "feeds:list":
          return state.feeds;
        case "readwise:status":
          return state.readwise;
        case "suggestions:forWindow":
          return state.heads[
            (args as { requestedMinutes: number }).requestedMinutes
          ];
        case "suggestions:shortestUnread":
          return state.shortest;
        case "documentImports:latest":
          return state.latestImport;
      }
      throw new Error(`unexpected query ${name}`);
    },
    usePaginatedQuery: () => state.paged,
    useAction: () => vi.fn(),
    useMutation: (fn: unknown) => {
      const name = getFunctionName(fn as never);
      return (args: Record<string, unknown>) =>
        new Promise((resolve, reject) => {
          state.pending.push({ name, args, resolve, reject });
        });
    },
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ push: state.push, prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/components/article-finder", () => ({
  ArticleFinder: ({ showKey }: { showKey?: boolean }) => (
    <button type="button">
      Ask, or paste a link{showKey ? <kbd>/</kbd> : null}
    </button>
  ),
}));
vi.mock("framer-motion", () => {
  const passthrough =
    (Tag: "div" | "section" | "li") =>
    ({
      children,
      className,
      onAnimationComplete,
    }: {
      children?: React.ReactNode;
      className?: string;
      onAnimationComplete?: () => void;
    }) => {
      const Element = Tag;
      // The mock completes entry after commit, as real motion does.
      useEffect(() => {
        if (state.pauseMotion && onAnimationComplete)
          state.animations.push(onAnimationComplete);
        else onAnimationComplete?.();
      });
      return <Element className={className}>{children}</Element>;
    };
  return {
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      div: passthrough("div"),
      section: passthrough("section"),
      li: passthrough("li"),
    },
  };
});

const card = (id: string, minutes = 2) => ({
  _id: id,
  title: `Title ${id}`,
  author: "Author",
  url: `https://www.example.com/${id}`,
  estimatedReadMinutes: minutes,
  reason: "Fits your window",
  book: null,
});
const overview = (extra: Record<string, unknown> = {}) => ({
  annotatedTotal: 12,
  waiting: 9,
  fits: { 5: 3, 10: 12, 20: 5, 30: 9 },
  upNext: [],
  ...extra,
});

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  markFinished(Number.NEGATIVE_INFINITY);
  state.overview = overview();
  state.pauseMotion = false;
  state.animations = [];
  state.inProgress = null;
  state.resumeReady = true;
  state.due = [];
  state.feeds = [];
  state.readwise = { connected: false };
  state.heads = {
    5: [card("a"), card("b"), card("c")],
    10: [card("a"), card("b"), card("c")],
    20: [card("x"), card("y")],
  };
  state.paged = { results: [], status: "CanLoadMore", loadMore: vi.fn() };
  state.shortest = null;
  state.latestImport = null;
  state.failOverview = false;
  state.search = "";
  state.push = vi.fn();
  state.prewarm = vi.fn();
  state.pending = [];
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const render = () =>
  act(async () =>
    root.render(
      <AltHintProvider>
        <DeskRoute />
      </AltHintProvider>,
    ),
  );
const text = () => document.body.textContent ?? "";
const button = (label: string | RegExp) =>
  [...document.querySelectorAll("button")].find((b) =>
    typeof label === "string"
      ? b.textContent?.trim() === label
      : label.test(b.textContent ?? ""),
  ) as HTMLButtonElement;
const time = (minutes: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[aria-keyshortcuts]")].find(
    (b) => b.querySelector("span")?.textContent === minutes,
  ) as HTMLButtonElement;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Outcomes the reader caused; the offer recorded on show is checked separately. */
const calls = (name: string) =>
  state.pending.filter(
    (m) =>
      m.name === name &&
      !(name === "sessions:recordInteraction" && m.args.action === "presented"),
  );
const offers = () =>
  state.pending.filter(
    (m) =>
      m.name === "sessions:recordInteraction" && m.args.action === "presented",
  );
/** Resolves every pending mutation (session creates get ids s1, s2...) and lets React settle. */
let sessions = 0;
const settle = () =>
  act(async () => {
    for (const m of state.pending.splice(0))
      m.resolve(m.name === "sessions:create" ? `s${++sessions}` : undefined);
    await vi.advanceTimersByTimeAsync(1);
  });

describe("desk at rest", () => {
  it("consumes finish arrival once, so later picks never inherit its delay", async () => {
    markFinished();
    await render();
    const slot = document.querySelector('section[aria-label="Your pick"]');
    expect(slot?.getAttribute("data-arrival")).toBeTruthy();
    await advance(560);
    expect(slot?.getAttribute("data-arrival")).toBeNull();
    await act(async () => time("10").click());
    expect(slot?.getAttribute("data-arrival")).toBeNull();
  });
  it("renders Continue while unrelated counters and revisit data are pending", async () => {
    state.overview = undefined;
    state.inProgress = {
      article: { _id: "fast", title: "Ready now" },
      scrollPercent: 20,
    };
    await render();
    expect(
      document.querySelector('a[href="/read/fast"]')?.textContent,
    ).toContain("Ready now");
    expect(text()).toContain("Continue");
  });
  it("shows the question, the times and the bar, and nothing of the pile", async () => {
    state.inProgress = {
      article: { _id: "p", title: "In progress" },
      scrollPercent: 40,
      remainingMinutes: 8,
    };
    state.overview = overview({
      upNext: [{ _id: "u", title: "Queued title" }],
      latestNote: { text: "A note body" },
    });
    await render();
    expect(text()).toContain("How much time");
    for (const n of ["5", "10", "20", "30+"]) expect(time(n)).toBeTruthy();
    expect(text()).toContain("Ask, or paste a link");
    // No counts, shelves, timelines, shortcut hint or keycaps
    expect(text()).not.toMatch(
      /waiting|\d+ fit|Up next|From your notes|Recently rated|Where it comes from|keyboard shortcuts|Queued title/,
    );
    expect(document.querySelector("kbd")).toBeNull();
    // Counts live in the tooltip only
    expect(time("10").title).toContain("12 fit");
    expect(time("10").title).toContain("press 2");
  });

  it("Continue shows the minutes left, with an ink bar and no pen colour", async () => {
    state.inProgress = {
      article: { _id: "p", title: "In progress" },
      scrollPercent: 40,
      remainingMinutes: 8,
    };
    await render();
    expect(text()).toContain("Continue");
    expect(text()).toContain("8 min left");
    const bar = document.querySelector('[role="progressbar"]');
    expect(bar?.innerHTML).toContain("var(--ink)");
    expect(document.body.innerHTML).not.toContain("--pen)");
    // `c` opens it
    await press("c");
    expect(state.push).toHaveBeenCalledWith("/read/p");
  });

  it("offers a revisit only when nothing is in progress", async () => {
    state.due = [
      {
        articleId: "r",
        daysSinceLastRead: 200,
        article: { title: "Old favourite" },
      },
    ];
    await render();
    expect(text()).toContain("Worth revisiting · loved 7 months ago");
    expect(document.querySelector('a[href="/read/r"]')?.textContent).toBe(
      "Read again",
    );
    expect(button("Not now")).toBeTruthy();

    state.inProgress = {
      article: { _id: "p", title: "In progress" },
      scrollPercent: 40,
      remainingMinutes: 8,
    };
    await render();
    expect(text()).not.toContain("Worth revisiting");
  });

  it("carries compact checkpoint progress/paragraph zero to the rendered link and shortcut", async () => {
    state.inProgress = {
      article: { _id: "checkpoint", title: "Persisted place" },
      scrollPercent: 45,
      paragraphIndex: 0,
      remainingMinutes: 11,
    };
    await render();
    expect(
      document.querySelector('a[href="/read/checkpoint?p=0"]')?.textContent,
    ).toContain("Persisted place");
    expect(
      document
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("45");
    await press("c");
    expect(state.push).toHaveBeenLastCalledWith("/read/checkpoint?p=0");
  });

  it("preserves unit zero and next-part links for both Continue entry points", async () => {
    for (const unitIndex of [0, 1]) {
      state.inProgress = {
        article: { _id: "book", title: "A book" },
        unitIndex,
        scrollPercent: 0,
        remainingMinutes: 10,
        part: { number: unitIndex + 1, count: 2, title: "Next chapter" },
      };
      await render();
      expect(
        document.querySelector(`a[href="/read/book?unit=${unitIndex}"]`)
          ?.textContent,
      ).toContain("Next chapter");
      await press("c");
      expect(state.push).toHaveBeenLastCalledWith(
        `/read/book?unit=${unitIndex}`,
      );
    }
  });

  it("does not mistake a partial resume migration for an empty or finished library", async () => {
    state.resumeReady = false;
    state.overview = overview({ waiting: 0, annotatedTotal: 0 });
    await render();
    expect(text()).toContain("Preparing your saved reading place");
    expect(text()).not.toContain("You've read everything");
    expect(text()).not.toContain("Nothing to read yet");
    await press("c");
    expect(state.push).not.toHaveBeenCalled();
  });

  it("an empty library asks for one thing", async () => {
    state.overview = overview({ annotatedTotal: 0, waiting: 0 });
    await render();
    expect(text()).toContain(
      "Nothing to read yet. Add a source, or paste a link with /",
    );
    expect(document.querySelector('a[href="/feeds"]')?.textContent).toBe(
      "Add a source",
    );
  });

  it("says everything is read, with no button, when nothing waits", async () => {
    state.overview = overview({ waiting: 0 });
    await render();
    expect(text()).toContain(
      "You've read everything waiting. New articles arrive as your sources update.",
    );
    expect(
      document.querySelector('section[aria-label="Your pick"] a'),
    ).toBeNull();
  });

  it("fails in place with a Retry that reloads the slot", async () => {
    state.failOverview = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    expect(text()).toContain("Couldn't load your desk.");
    expect(text()).toContain("How much time");
    state.failOverview = false;
    await act(async () => button("Retry").click());
    expect(text()).not.toContain("Couldn't load your desk");
  });
});

describe("bringing a PDF", () => {
  const row = (extra: Record<string, unknown>) => ({
    _id: "imp1",
    fileName: "Thinking in Systems.pdf",
    status: "reading",
    step: "text",
    ...extra,
  });

  it("shows the steps as the book is read in, in the slot", async () => {
    state.latestImport = row({ step: "point", pages: 412, units: 58 });
    await render();
    expect(text()).toContain("Reading in your PDF");
    expect(text()).toContain("Thinking in Systems");
    expect(text()).toContain("Text from all 412 pages");
    expect(text()).toContain("58 reading parts from its chapters");
    expect(text()).toContain("Opening it for reading…");
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    // Nothing of the resting desk competes with it
    expect(text()).not.toContain("You've read everything");
  });

  it("opens the book from Ready, naming the first part", async () => {
    state.latestImport = row({
      status: "ready",
      step: "point",
      title: "Thinking in Systems",
      articleId: "book1",
      pages: 412,
      units: 58,
      minutes: 406,
      firstUnitTitle: "A brief visit to the systems zoo",
      firstUnitMinutes: 6,
    });
    await render();
    expect(text()).toContain("Ready to read");
    expect(text()).toContain("412 pages · 58 parts of about 7 min");
    expect(text()).toContain(
      "Starts with “A brief visit to the systems zoo”, 6 min.",
    );
    const start = [...document.querySelectorAll("a")].find(
      (a) => a.textContent === "Start reading",
    );
    expect(start?.getAttribute("href")).toBe("/read/book1");
    await act(async () => start?.click());
    expect(calls("documentImports:dismiss")).toHaveLength(1);
  });

  it("refuses a scanned PDF in one plain sentence and says nothing was added", async () => {
    state.latestImport = row({ status: "failed", failure: "scanned" });
    await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "This PDF is scanned pages, with no text to read.",
    );
    expect(text()).toContain("Nothing was added to your library.");
    expect(button("Choose another file")).toBeTruthy();
  });

  it("gives a chosen time the pick, and the import waits for the rest state", async () => {
    state.latestImport = row({ status: "failed", failure: "scanned" });
    await render();
    await act(async () => time("10").click());
    expect(text()).toContain("For 10 minutes");
    expect(text()).not.toContain("scanned pages");
  });
});

describe("a book in the pick", () => {
  it("names the part, its title and where the reader left off", async () => {
    state.heads[10] = [
      {
        ...card("book1", 9),
        title: "Thinking in Systems · Part 12 of 58",
        url: "upload:abc",
        reason: "You finished part 11. This picks up where you left off.",
        book: {
          unitIndex: 11,
          unitTitle: "Why systems surprise us",
          started: true,
        },
      },
    ];
    await render();
    await act(async () => time("10").click());
    expect(text()).toContain("Thinking in Systems · Part 12 of 58");
    expect(text()).toContain(
      "“Why systems surprise us” · 9 min · the next part after where you stopped",
    );
    expect(text()).toContain("This picks up where you left off.");
  });
});

describe("choosing a time", () => {
  it("does not act on the next card while the previous title is still exiting", async () => {
    await render();
    await act(async () => time("10").click());
    state.pauseMotion = true;
    await act(async () => button("Another").click());
    await act(async () => button("Another").click());
    expect(text()).toContain("Title b");
    await act(async () => state.animations.at(-1)?.());
    await act(async () => button("Another").click());
    expect(text()).toContain("Title c");
  });

  it("opens immediately and never navigates again when a replaced deck's session resolves late", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Read now").click());
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.push.mock.calls[0][0]).toMatch(
      /^\/read\/a\?sessionKey=[\da-f-]{36}&minutes=10$/,
    );
    const old = calls("sessions:create")[0];
    await act(async () => time("20").click());
    await act(async () => old.resolve("old-session"));
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Title x");
  });
  it("accepts the next card immediately after entry, without a timer cooldown", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Another").click());
    expect(text()).toContain("Title b");
    await act(async () => button("Another").click());
    expect(text()).toContain("Title c");
  });
  it("renders the pick at once, before the session exists, and without a route change", async () => {
    await render();
    await act(async () => time("10").click());
    expect(text()).toContain("For 10 minutes");
    expect(text()).toContain("Title a");
    expect(text()).toContain("example.com · 2 min");
    expect(text()).toContain("1 of 3+");
    expect(calls("sessions:create")).toHaveLength(1);
    expect(state.push).not.toHaveBeenCalled();
    // The chosen time stays lit, the others dim
    expect(time("10").className).toContain("--ink)");
    expect(time("5").className).toContain("--ink-muted");
  });

  it("records each card as offered once, in the session, when it is shown", async () => {
    await render();
    expect(offers()).toHaveLength(0);
    await act(async () => time("10").click());
    await act(async () => {
      calls("sessions:create")[0].resolve("s-first");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(offers().map((m) => m.args)).toEqual([
      { articleId: "a", sessionId: "s-first", action: "presented" },
    ]);
    const sent = offers().map((m) => m.args.articleId);
    await settle();
    await act(async () => button("Another").click());
    for (let i = 0; i < 4; i++) {
      sent.push(...offers().map((m) => m.args.articleId));
      await settle();
    }
    // One offer per card shown, however many times the page re-rendered
    expect(sent).toEqual(["a", "b"]);
  });

  it("queues interactions until the session id arrives", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Another").click());
    expect(text()).toContain("Title b");
    expect(calls("sessions:recordInteraction")).toHaveLength(0);
    await act(async () => {
      calls("sessions:create")[0].resolve("s-first");
      await vi.advanceTimersByTimeAsync(0);
    });
    const recorded = calls("sessions:recordInteraction");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].args).toMatchObject({
      articleId: "a",
      sessionId: "s-first",
      action: "skipped",
    });
  });

  it("sends interactions to the session of the time they were made in, when the reader switches while the first is still being created", async () => {
    await render();
    await act(async () => time("10").click());
    await advance(DOUBLE_CHOICE_MS + 1);
    await act(async () => time("20").click());
    expect(
      calls("sessions:create").map((m) => m.args.requestedMinutes),
    ).toEqual([10, 20]);
    expect(text()).toContain("Title x");
    expect(text()).not.toContain("Title a");
    await act(async () => button("Another").click());
    await act(async () => {
      calls("sessions:create")[1].resolve("s-twenty");
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      calls("sessions:create")[0].resolve("s-ten");
      await vi.advanceTimersByTimeAsync(0);
    });
    const recorded = calls("sessions:recordInteraction");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].args).toMatchObject({
      articleId: "x",
      sessionId: "s-twenty",
    });
  });

  it("records without a session when it can't be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Another").click());
    await act(async () => {
      calls("sessions:create")[0].reject(new Error("offline"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      calls("sessions:recordInteraction")[0].args.sessionId,
    ).toBeUndefined();
  });

  it("a double click on a time keeps it chosen; a later click on it returns to rest", async () => {
    await render();
    await act(async () => {
      time("10").click();
      time("10").click();
    });
    expect(text()).toContain("For 10 minutes");
    expect(calls("sessions:create")).toHaveLength(1);
    await advance(DOUBLE_CHOICE_MS + 1);
    await act(async () => time("10").click());
    expect(text()).not.toContain("For 10 minutes");
  });

  it("Esc returns the slot to rest, and the keys 1-4 choose", async () => {
    state.inProgress = {
      article: { _id: "p", title: "In progress" },
      scrollPercent: 40,
      remainingMinutes: 8,
    };
    await render();
    await press("2");
    expect(text()).toContain("For 10 minutes");
    expect(text()).not.toContain("Continue");
    await press("Escape");
    expect(text()).toContain("Continue");
    await press("3");
    expect(text()).toContain("For 20 minutes");
    await advance(DOUBLE_CHOICE_MS + 1);
    await press("3");
    expect(text()).toContain("Continue");
    await press("1");
    expect(text()).toContain("For 5 minutes");
    await press("4");
    expect(text()).toContain("For 30 minutes");
    // `c` still opens the article that is covered by the pick
    await press("c");
    expect(state.push).toHaveBeenCalledWith("/read/p");
  });

  it("starts a fresh deck for each time", async () => {
    await render();
    await press("2");
    await act(async () => button("Another").click());
    await settle();
    expect(text()).toContain("Title b");
    await advance(DOUBLE_CHOICE_MS + 1);
    await press("3");
    expect(text()).toContain("Title x");
    expect(text()).toContain("1 of 2+");
    expect(text()).not.toContain("Title b");
  });

  it("prefetches a window on hover and on keyboard focus, not on keys alone", async () => {
    await render();
    await act(async () => {
      time("20").dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
    });
    expect(state.prewarm).toHaveBeenCalledWith(
      expect.objectContaining({ args: { requestedMinutes: 20 } }),
    );
    await act(async () => time("5").focus());
    expect(state.prewarm).toHaveBeenCalledWith(
      expect.objectContaining({ args: { requestedMinutes: 5 } }),
    );
  });

  it("shows its own skeleton only after 150 ms, then the pick when it arrives", async () => {
    state.heads[10] = undefined;
    state.paged = {
      results: [],
      status: "LoadingFirstPage",
      loadMore: vi.fn(),
    };
    await render();
    await act(async () => time("10").click());
    expect(text()).toContain("For 10 minutes");
    expect(document.querySelector('[data-testid="pick-skeleton"]')).toBeNull();
    await advance(SKELETON_DELAY_MS - 1);
    expect(document.querySelector('[data-testid="pick-skeleton"]')).toBeNull();
    await advance(1);
    expect(
      document.querySelector('[data-testid="pick-skeleton"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="pick-skeleton"]')?.textContent,
    ).toContain("Read now");
    expect(
      document.querySelector('[data-testid="pick-skeleton"] button'),
    ).toBeNull();
    expect(
      document.querySelector('[role="status"] svg, .animate-spin'),
    ).toBeNull();
    state.heads[10] = [card("a")];
    await render();
    expect(text()).toContain("Title a");
    expect(state.prewarm).toHaveBeenCalledWith(
      expect.objectContaining({ args: { articleId: "a" } }),
    );
    expect(document.querySelector('[data-testid="pick-skeleton"]')).toBeNull();
  });

  it("a choice that races its prefetch lands on the same pick once the answer arrives", async () => {
    state.heads[10] = undefined;
    await render();
    await act(async () => time("10").click());
    await act(async () => {
      time("10").dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
    });
    state.heads[10] = [card("a"), card("b")];
    await render();
    expect(text()).toContain("Title a");
    expect(text()).toContain("1 of 2+");
  });

  it("says when nothing fits and offers the shortest as a labelled choice", async () => {
    state.heads[5] = [];
    state.paged = { results: [], status: "Exhausted", loadMore: vi.fn() };
    state.shortest = {
      _id: "s",
      title: "Notes on a quiet desk",
      estimatedReadMinutes: 7,
    };
    await render();
    await act(async () => time("5").click());
    expect(text()).toContain("Nothing fits in 5 minutes.");
    expect(text()).toContain("The shortest unread article is 7 min");
    expect(document.querySelector('a[href="/read/s"]')?.textContent).toBe(
      "Read it anyway",
    );
    await act(async () => button("Try a different time").click());
    expect(text()).not.toContain("Nothing fits");
  });

  it("a double Another moves one card, not two, and records once", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => {
      button("Another").click();
      button("Another").click();
    });
    await act(async () => {
      calls("sessions:create")[0].resolve("s1");
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
    expect(text()).toContain("Title b");
    expect(text()).not.toContain("Title c");
    expect(calls("sessions:recordInteraction")).toHaveLength(1);
  });

  it("Another on the last loaded card, with the next page pending, waits for the card that arrives", async () => {
    state.paged.status = "LoadingMore";
    await render();
    await act(async () => time("10").click());
    for (let i = 0; i < 3; i++) {
      await act(async () => button("Another").click());
      await settle();
    }
    expect(text()).not.toContain("That's everything");
    expect(
      document.querySelector('[data-testid="pick-skeleton"]') ||
        text().includes("For 10 minutes"),
    ).toBeTruthy();
    state.paged = {
      results: [card("d")],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
    await render();
    expect(text()).toContain("Title d");
    expect(text()).toContain("4 of 4");
  });

  it("Save for later saves first, then records and moves on", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Save for later").click());
    expect(calls("savedArticles:save")).toHaveLength(1);
    expect(text()).toContain("Title a");
    await act(async () => {
      calls("savedArticles:save")[0].resolve();
      calls("sessions:create")[0].resolve("s1");
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
    expect(text()).toContain("Title b");
    expect(calls("sessions:recordInteraction")[0].args).toMatchObject({
      articleId: "a",
      action: "saved",
      sessionId: "s1",
    });
  });

  it("Save for later says Saved in place of the action, with no toast", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Save for later").click());
    await act(async () => {
      calls("savedArticles:save")[0].resolve();
      calls("sessions:create")[0].resolve("s1");
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
    expect(document.querySelector(".saved-mark")?.textContent).toBe("Saved");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent === "Save for later",
      )?.hidden,
    ).toBe(true);
    // It clears itself after its fade, 1.6 s held
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVED_MS + 1);
    });
    expect(document.querySelector(".saved-mark")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a failed save says so in place with Retry, and Retry tries again", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Save for later").click());
    await act(async () => {
      calls("savedArticles:save")[0].reject(new Error("offline"));
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't save that article.",
    );
    expect(text()).toContain("Title a");
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => button("Retry").click());
    expect(calls("savedArticles:save")).toHaveLength(2);
    await act(async () => {
      calls("savedArticles:save")[1].resolve();
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector(".saved-mark")?.textContent).toBe("Saved");
  });

  it("Read now opens immediately with the session's stable attribution key", async () => {
    await render();
    await act(async () => time("10").click());
    await act(async () => button("Read now").click());
    expect(state.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/read\/a\?sessionKey=[\da-f-]{36}&minutes=10$/),
      { transitionTypes: ["open-article"] },
    );
    await act(async () => {
      calls("sessions:create")[0].resolve("s-open");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state.push).toHaveBeenCalledTimes(1);
    // The reader draws this title in the same commit, so the morph has a destination
    expect(rememberedTitle("a")).toBe("Title a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls("sessions:recordInteraction")[0].args).toMatchObject({
      action: "opened",
      sessionId: "s-open",
    });
  });
});

describe("keys on a pick", () => {
  const choose = async () => {
    await render();
    await press("2");
    await act(async () => {
      calls("sessions:create")[0].resolve("s1");
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
  };
  const typeIn = (key: string) => {
    const input = document.body.appendChild(document.createElement("input"));
    input.focus();
    return act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };

  it("n and the right arrow show another, the left arrow goes back", async () => {
    await choose();
    expect(text()).toContain("Title a");
    await press("n");
    await advance(SETTLE_MS + 1);
    expect(text()).toContain("Title b");
    await press("ArrowRight");
    await advance(SETTLE_MS + 1);
    expect(text()).toContain("Title c");
    await press("ArrowLeft");
    await advance(SETTLE_MS + 1);
    expect(text()).toContain("Title b");
    await press("ArrowLeft");
    await advance(SETTLE_MS + 1);
    expect(text()).toContain("Title a");
    // Nothing before the first pick, so the arrow is left to the browser
    let prevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    expect(text()).toContain("Title a");
  });

  it("Enter and o read the pick", async () => {
    await choose();
    await press("Enter");
    await advance(0);
    expect(state.push).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\/read\/a\?sessionKey=[\da-f-]{36}&minutes=10$/),
      {
        transitionTypes: ["open-article"],
      },
    );
    await advance(SETTLE_MS + 1);
    await press("o");
    await advance(0);
    expect(state.push).toHaveBeenCalledTimes(2);
  });

  it("Enter on a focused button is that button's own", async () => {
    await choose();
    const another = button("Another");
    another.focus();
    await act(async () => {
      another.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("s saves the pick", async () => {
    await choose();
    await press("s");
    expect(calls("savedArticles:save")).toHaveLength(1);
    expect(calls("savedArticles:save")[0].args).toEqual({ articleId: "a" });
  });

  it("none of these fire while typing in a field", async () => {
    await choose();
    for (const key of ["n", "o", "s", "Enter", "ArrowRight"]) await typeIn(key);
    await advance(SETTLE_MS + 1);
    expect(text()).toContain("Title a");
    expect(state.push).not.toHaveBeenCalled();
    expect(calls("savedArticles:save")).toHaveLength(0);
  });

  it("shows the keycaps for the pick while Alt is held", async () => {
    await choose();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Alt", altKey: true }),
      );
    });
    await advance(ALT_HOLD_MS);
    expect(button(/^Read now/).querySelector("kbd")?.textContent).toBe("o");
    expect(button(/^Another/).querySelector("kbd")?.textContent).toBe("n");
  });
});

describe("annotating ahead", () => {
  const deferred = (id: string) => ({ ...card(id, 25), deferred: true });
  const asked = () =>
    calls("articles:annotateAhead").map((m) => m.args.articleIds);
  // Unlike settle(), keeps the lookahead requests in view
  const another = async () => {
    await act(async () => button("Another").click());
    await act(async () => {
      for (const m of calls("sessions:create")) m.resolve("s1");
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
  };

  it("asks for the card shown and the next two, then tops up on Another", async () => {
    state.heads[30] = [deferred("a"), deferred("b"), card("c", 5)];
    state.paged = {
      results: [deferred("d"), deferred("e")],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
    await render();
    await press("4");
    // c is already annotated, so only the deferred two are asked for
    expect(asked()).toEqual([["a", "b"]]);
    await another();
    expect(asked()).toEqual([["a", "b"], ["d"]]);
    await another();
    expect(asked()).toEqual([["a", "b"], ["d"], ["e"]]);
  });

  it("asks again for a card whose request failed, on the next card", async () => {
    state.heads[30] = [deferred("a"), deferred("b")];
    state.paged = { results: [], status: "Exhausted", loadMore: vi.fn() };
    await render();
    await press("4");
    await act(async () => {
      calls("articles:annotateAhead")[0].reject(new Error("paused"));
      await vi.advanceTimersByTimeAsync(0);
    });
    await another();
    expect(asked()).toEqual([["a", "b"], ["b"]]);
  });

  it("asks for nothing when no card is deferred", async () => {
    await render();
    await act(async () => time("10").click());
    expect(calls("articles:annotateAhead")).toHaveLength(0);
  });
});

describe("deep link", () => {
  it("renders the chosen state for an existing session without creating another", async () => {
    state.search = "m=10&session=s9";
    await render();
    expect(text()).toContain("For 10 minutes");
    expect(text()).toContain("Title a");
    expect(calls("sessions:create")).toHaveLength(0);
    await act(async () => button("Another").click());
    await advance(0);
    expect(calls("sessions:recordInteraction")[0].args).toMatchObject({
      sessionId: "s9",
      action: "skipped",
    });
  });

  it("ignores a window that makes no sense", async () => {
    state.search = "m=9999";
    await render();
    expect(text()).not.toContain("For 9999 minutes");
  });
});

describe("holding Alt", () => {
  const alt = (type: "keydown" | "keyup", init: KeyboardEventInit = {}) =>
    act(async () => {
      window.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Alt",
          altKey: type === "keydown",
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });

  it("shows the keycaps after 400 ms and hides them on release", async () => {
    state.inProgress = {
      article: { _id: "p", title: "In progress" },
      scrollPercent: 40,
      remainingMinutes: 8,
    };
    await render();
    await alt("keydown");
    await advance(ALT_HOLD_MS - 1);
    expect(document.querySelector("kbd")).toBeNull();
    await advance(1);
    const keys = [...document.querySelectorAll("kbd")].map(
      (k) => k.textContent,
    );
    expect(keys).toEqual(
      expect.arrayContaining(["1", "2", "3", "4", "/", "c"]),
    );
    await alt("keyup");
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("a quick tap, or Alt with another key, shows nothing and never blocks the browser", async () => {
    await render();
    let prevented = false;
    await act(async () => {
      const down = new KeyboardEvent("keydown", {
        key: "Alt",
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(down);
      prevented = down.defaultPrevented;
    });
    await advance(100);
    await alt("keyup");
    await advance(ALT_HOLD_MS);
    expect(document.querySelector("kbd")).toBeNull();
    expect(prevented).toBe(false);

    await alt("keydown");
    await act(async () => {
      const combo = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(combo);
      prevented = combo.defaultPrevented;
    });
    await advance(ALT_HOLD_MS + 1);
    expect(document.querySelector("kbd")).toBeNull();
    expect(prevented).toBe(false);
    // Alt+1 doesn't choose a time
    await press("1", { altKey: true });
    expect(text()).not.toContain("For 5 minutes");
  });
});
