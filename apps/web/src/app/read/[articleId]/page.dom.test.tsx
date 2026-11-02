// @vitest-environment happy-dom

import { sourceHash } from "@marginalia/backend/prepared-representation";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/reader-settings";
import ReadPage from "./page";

// Test settled UI states; happy-dom cannot finish/cancel native motion reliably.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const { createElement, Fragment } = await import("react");
  const tags = new Map<string, unknown>();
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => {
          if (!tags.has(tag))
            tags.set(
              tag,
              ({
                children,
                initial: _initial,
                animate: _animate,
                exit: _exit,
                transition: _transition,
                variants: _variants,
                layout: _layout,
                ...props
              }: Record<string, unknown>) =>
                createElement(tag, props, children as React.ReactNode),
            );
          return tags.get(tag);
        },
      },
    ),
  };
});

const state = vi.hoisted(() => ({
  progress: 0,
  empty: [],
  noop: () => {},
  asyncNoop: async () => {},
  observers: 0,
  reflectionSaved: true,
  bible: false,
  html: "",
  licensed: false,
  summarize: vi.fn(async () => {}),
  reflection: null as {
    _id: string;
    strongestPoint: string;
    weakestAssumption: string;
    credibleCounterview: string;
    questionForYou: string;
  } | null,
  finish: vi.fn(async () => {}),
  push: vi.fn(),
  query: vi.fn(),
  open: vi.fn(),
  stop: vi.fn(),
  loadMore: vi.fn(),
  pages: [] as { name: string; args: unknown }[],
  params: "",
  scopeReady: true,
  missingArticle: false,
  // SAFETY: tests assign only the bootstrap source shape; null means no subscription.
  feed: null as {
    _id: string;
    title: string;
    isActive: boolean;
  } | null,
  more: false,
  landed: false,
  marginMode: "sidenotes",
  fragmented: false,
  clicked: [] as string[],
  thread: null as import("@/lib/companion").CompanionThread | null,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ articleId: "article-1" }),
  useSearchParams: () => new URLSearchParams(state.params),
  useRouter: () => ({ push: state.push, replace: state.noop }),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "annotations:listByArticle") return annotations;
    if (name === "reflections:getByArticle") return state.reflection;
    if (
      [
        "userNotes:listByArticle",
        "companionThreads:listByArticle",
        "highlights:listByArticle",
      ].includes(name)
    )
      return state.empty;
    return null;
  },
  useMutation: () => state.asyncNoop,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/summarize:generate"
      ? state.summarize
      : state.asyncNoop,
  useConvex: () => ({ query: state.query }),
  usePaginatedQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) => {
    const name = getFunctionName(ref);
    state.pages.push({ name, args });
    return {
      results:
        args === "skip"
          ? state.empty
          : name === "annotations:listPresentationByArticle"
            ? annotations
            : state.empty,
      status:
        args === "skip"
          ? "LoadingFirstPage"
          : state.more
            ? "CanLoadMore"
            : "Exhausted",
      loadMore: state.loadMore,
    };
  },
}));
const annotations = [{ _id: "a1", type: "context", content: "A margin note." }];
const article = {
  title: "Invented article",
  content: "Invented prose",
  contentHtml: "<p>Invented prose</p>",
  url: "https://example.com",
  wordCount: 2,
  annotationStatus: "annotated",
  estimatedReadMinutes: 1,
};
vi.mock("@/lib/use-book-reading", () => ({
  useReadable: () => ({
    article: state.missingArticle
      ? null
      : state.licensed
        ? {
            ...article,
            title: "Psalms 23",
            content: "Licensed-display-canary",
            contentHtml: "<p>Licensed-display-canary</p>",
          }
        : state.bible
          ? {
              ...article,
              _id: "article-1",
              bible: {
                reference: "Psalms 23",
                translation: "web",
                copyright: "Public domain",
              },
            }
          : article,
    sourceArticle: state.licensed
      ? {
          ...article,
          title: "Psalms 23",
          content: "23:1 Public-domain WEB source",
          contentHtml: undefined,
          bible: {
            reference: "Psalms 23",
            translation: "web",
            displayVersionId: 111,
            copyright: "Public domain",
          },
        }
      : undefined,
    isBook: false,
    unitIndex: null,
    scopeReady: state.scopeReady,
    feed: state.feed,
    missingArticle: state.missingArticle,
  }),
  useBookProgress: () => {},
}));
vi.mock("@/lib/reader-settings", async (original) => {
  const module = await original<typeof import("@/lib/reader-settings")>();
  return {
    ...module,
    useReaderSettings: () => ({
      settings: DEFAULT_SETTINGS,
      update: state.noop,
      resetText: state.noop,
    }),
  };
});
vi.mock("@/lib/companion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/companion")>()),
  usePassageHighlight: () => {},
  useCompanion: () => ({
    answers: state.empty,
    thread: state.thread,
    openId: null,
    start: state.noop,
    collapse: state.noop,
    open: state.open,
    stop: state.stop,
    openAnswer: state.noop,
    startArticle: state.noop,
    keep: state.asyncNoop,
    remove: state.asyncNoop,
    forget: state.noop,
  }),
}));
vi.mock("@/lib/use-engagement-tracker", () => ({
  useEngagementTracker: () => ({
    progress: state.progress,
    trackAnnotationOpen: state.noop,
    finish: state.finish,
    retry: state.asyncNoop,
  }),
}));
vi.mock("@/lib/reading-modes", () => ({
  useReadingPosition: () => ({ current: 0, firstVisible: 0, lastVisible: 0 }),
  useListen: () => ({ active: false, stop: state.noop }),
}));
vi.mock("@/lib/use-margin-mode", () => ({
  useMarginMode: () => state.marginMode,
  usePrefersReducedMotion: () => true,
}));
vi.mock("@/lib/highlights", () => ({
  useHighlights: () => state.empty,
  findMark: () => null,
}));
vi.mock("@/lib/saved-passages", () => ({
  useSavedPassages: () => state.empty,
}));
vi.mock("@/lib/use-mark-paint", () => ({ useMarkPaint: () => {} }));
vi.mock("@/lib/use-mark-default", () => ({
  useSetMarkDefault: () => state.noop,
  useLegacyMarkDefaults: () => ({ colors: DEFAULT_SETTINGS }),
}));
vi.mock("@/lib/use-read-alongside", () => ({ useReadAlongside: () => null }));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: () => {} }));
vi.mock("@/lib/use-place-restore", () => ({ usePlaceRestore: () => {} }));
vi.mock("@/lib/use-quote-landing", async (original) => ({
  ...(await original<typeof import("@/lib/use-quote-landing")>()),
  useQuoteLanding: () => state.landed,
}));
vi.mock("@/lib/use-is-intersecting", () => ({
  useIsIntersecting: () => false,
}));
vi.mock("@/lib/use-start-annotation", () => ({
  useStartAnnotation: () => {},
  marginNotesPending: () => false,
}));
// React 19 rewrites innerHTML whenever the prop object changes, which would wipe the paragraph tags.
const markups = new Map<string, { __html: string }>();
const markup = (html: string) => {
  const known = markups.get(html) ?? { __html: html };
  markups.set(html, known);
  return known;
};
vi.mock("@/components/article-renderer", () => ({
  ArticleRenderer: () =>
    state.html ? (
      <div
        data-article-body
        // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed test markup
        dangerouslySetInnerHTML={markup(state.html)}
      />
    ) : (
      <div data-article-body>
        <p>
          <mark
            className="annotation-mark"
            data-annotation-id="a1"
            onClick={() => state.clicked.push("a1")}
          >
            Invented prose.
          </mark>
          {state.fragmented && (
            <>
              <mark
                className="annotation-mark"
                data-annotation-id="a1"
                onClick={() => state.clicked.push("a1")}
              >
                Second fragment.
              </mark>
              <mark
                className="annotation-mark"
                data-annotation-id="a2"
                onClick={() => state.clicked.push("a2")}
              >
                Another annotation.
              </mark>
            </>
          )}
        </p>
      </div>
    ),
}));
vi.mock("@/components/article-tags", () => ({ ArticleTags: () => null }));
vi.mock("@/components/article-ask", () => ({
  ArticleAsk: ({ hidden }: { hidden?: boolean }) =>
    hidden ? null : <button id="fixture-ask">Ask about this article</button>,
}));
vi.mock("@/components/companion-card", () => ({
  CompanionCard: ({ onStop, wide }: { onStop: () => void; wide?: boolean }) => (
    <button id="fixture-stop" data-readable-pane={wide} onClick={onStop}>
      Stop answer fixture
    </button>
  ),
}));
vi.mock("@/components/article-back-matter", () => ({
  ArticleBackMatter: ({
    reflectionFlush,
    onDone,
    reflection,
  }: {
    reflectionFlush: { current: (() => Promise<boolean>) | null };
    onDone: () => void;
    reflection?: { questionForYou: string } | null;
  }) => {
    reflectionFlush.current = async () => state.reflectionSaved;
    return (
      <>
        {reflection ? (
          <p data-testid="standard-reflection">{reflection.questionForYou}</p>
        ) : null}
        <button id="fixture-done" onClick={onDone}>
          Done fixture
        </button>
      </>
    );
  },
}));
vi.mock("@/components/reader-toolbar", () => ({
  ReaderToolbar: ({ tools }: { tools?: React.ReactNode }) => <>{tools}</>,
}));
vi.mock("@/components/bible-reader-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/bible-reader-tools")>()),
  BibleReaderTools: ({
    onWordStudy,
  }: {
    onWordStudy: (reference: string) => void;
  }) => (
    <button id="fixture-word-open" onClick={() => onWordStudy("Psalms 23:4")}>
      Word study
    </button>
  ),
}));
vi.mock("@/components/bible-word-study", () => ({
  BibleWordStudy: () => <p>Original-language details fixture</p>,
}));
vi.mock("@/components/selection-toolbar", () => ({
  SelectionToolbar: () => null,
}));
vi.mock("@/components/notes-panel", () => ({ NotesPanel: () => null }));
vi.mock("@/components/listen-bar", () => ({ ListenBar: () => null }));
vi.mock("@/components/reader-map", () => ({ ReaderMap: () => null }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.progress = 0;
  state.observers = 0;
  state.reflectionSaved = true;
  state.bible = false;
  state.html = "";
  state.licensed = false;
  state.summarize.mockClear();
  state.reflection = null;
  state.finish.mockClear();
  state.push.mockClear();
  state.query.mockReset();
  state.open.mockClear();
  state.stop.mockClear();
  state.loadMore.mockClear();
  state.pages = [];
  state.params = "";
  state.scopeReady = true;
  state.feed = null;
  state.missingArticle = false;
  state.more = false;
  state.landed = false;
  state.marginMode = "sidenotes";
  state.fragmented = false;
  state.clicked = [];
  state.thread = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor() {
        state.observers++;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  if (!CSS.escape) CSS.escape = (value) => value;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      const rects = this.matches("mark")
        ? [new DOMRect(100, 100, 100, 20)]
        : [];
      return Object.assign(rects, { item: (at: number) => rects[at] });
    },
  );
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});

it("shows the subscribed source and confirmation in the article header", async () => {
  state.feed = { _id: "feed-1", title: "The Weekly Letter", isActive: true };
  await act(async () => root.render(<ReadPage />));
  const header = document.querySelector("article header")!;
  expect(header.textContent).toContain("From The Weekly Letter");
  const unsubscribe = header.querySelector<HTMLButtonElement>(
    'button[aria-label="Unsubscribe from The Weekly Letter"]',
  )!;
  await act(async () => unsubscribe.click());
  expect(header.textContent).toContain("Remove this feed?");
  expect(header.textContent).toContain(
    "Articles with your highlights or notes stay.",
  );
  await act(async () =>
    unsubscribe.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(state.push).not.toHaveBeenCalled();
  expect(header.textContent).not.toContain("Remove this feed?");

  // The live bootstrap no longer offers unsubscribe after the source is gone.
  state.feed = null;
  await act(async () => root.render(<ReadPage />));
  expect(header.textContent).not.toContain("Unsubscribe");
  expect(document.querySelector("h1")?.textContent).toBe("Invented article");
});

it("offers a way back if source removal deletes the article being read", async () => {
  await act(async () => root.render(<ReadPage />));
  state.missingArticle = true;
  await act(async () => root.render(<ReadPage />));
  expect(document.body.textContent).toContain(
    "This article is no longer in your library.",
  );
  expect(document.querySelector("main a")?.textContent).toMatch(/^Back to /);
  expect(
    document.querySelector('[data-testid="reader-body-skeleton"]'),
  ).toBeNull();
});

it("binds Bible summaries to the saved WEB source even when it has no HTML", async () => {
  state.licensed = true;
  await act(async () => root.render(<ReadPage />));
  const entry = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Summary, key claims"),
  )!;
  await act(async () => entry.click());
  await vi.waitFor(() => expect(state.summarize).toHaveBeenCalledOnce());
  expect(state.summarize).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Psalms 23",
      paragraphs: ["23:1 Public-domain WEB source"],
      sourceHash: await sourceHash("23:1 Public-domain WEB source"),
    }),
  );
  expect(JSON.stringify(state.summarize.mock.calls)).not.toContain(
    "Licensed-display-canary",
  );
});
it("does not finish or navigate away from a reflection whose save failed", async () => {
  state.reflectionSaved = false;
  await act(async () => root.render(<ReadPage />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>("#fixture-done")?.click(),
  );
  expect(state.finish).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Couldn't save");
});
it("keeps the standard summary entry, header and bottom reflection for Bible content", async () => {
  state.bible = true;
  state.reflection = {
    _id: "reflection-fixture",
    strongestPoint: "A point",
    weakestAssumption: "An assumption",
    credibleCounterview: "An alternative",
    questionForYou: "The standard reflection question",
  };
  await act(async () => root.render(<ReadPage />));
  const summary = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Summary, key claims and a map"),
  );
  expect(summary).toBeDefined();
  const body = document.querySelector("[data-article-body]")!;
  const reflection = document.querySelector(
    '[data-testid="standard-reflection"]',
  )!;
  expect(
    summary!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    body.compareDocumentPosition(reflection) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(document.querySelector("article header nav")).toBeNull();
});
it("skips every preview collection until the readable unit scope resolves", async () => {
  state.scopeReady = false;
  await act(async () => root.render(<ReadPage />));
  expect(new Set(state.pages.map((page) => page.name))).toEqual(
    new Set([
      "annotations:listPresentationByArticle",
      "userNotes:listPreviewsByArticle",
      "companionThreads:listPreviewsByArticle",
      "highlights:listPresentationByArticle",
    ]),
  );
  expect(state.pages.every((page) => page.args === "skip")).toBe(true);
});
it("hydrates a linked saved answer outside the preview page, without a model call", async () => {
  state.params = "answer=saved-answer&quote=Invented";
  state.landed = true;
  const body = {
    _id: "saved-answer",
    articleId: "article-1",
    mode: "ask",
    turns: [{ role: "assistant", content: "Saved body" }],
  };
  state.query.mockResolvedValue(body);
  await act(async () => root.render(<ReadPage />));
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(getFunctionName(state.query.mock.calls[0][0])).toBe(
    "companionThreads:getBody",
  );
  expect(state.query.mock.calls[0][1]).toEqual({ threadId: "saved-answer" });
  expect(state.open).toHaveBeenCalledWith(body);
});

it("hydrates a summary definition even when its quote cannot land in article-body text", async () => {
  state.params = "answer=saved-summary&quote=steadfast";
  state.landed = false;
  const body = {
    _id: "saved-summary",
    articleId: "article-1",
    mode: "define",
    summaryDefinition: true,
    selection: "steadfast",
    turns: [{ role: "assistant", content: "Resolutely firm and unwavering." }],
  };
  state.query.mockResolvedValue(body);
  await act(async () => root.render(<ReadPage />));
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(state.query.mock.calls[0][1]).toEqual({ threadId: "saved-summary" });
  expect(state.open).toHaveBeenCalledWith(body);
});
it("does not reopen a pending linked answer after Cancel", async () => {
  state.params = "answer=late-answer&quote=Invented";
  state.landed = true;
  let resolve!: (body: unknown) => void;
  state.query.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(<ReadPage />));
  const cancel = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  );
  expect(cancel).toBeDefined();
  await act(async () => cancel!.click());
  await act(async () =>
    resolve({ _id: "late-answer", articleId: "article-1", turns: [] }),
  );
  expect(state.open).not.toHaveBeenCalled();
});
it("offers explicit continuation for additional margin data", async () => {
  state.more = true;
  await act(async () => root.render(<ReadPage />));
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === "Load more margin notes and marks",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(state.loadMore).toHaveBeenCalledTimes(4);
});
it("connects Stop to the currently open answer rather than cancelling another stream", async () => {
  state.marginMode = "sheet";
  state.thread = {
    id: "active-answer",
    mode: "article",
    selection: "",
    question: "Why?",
    paragraphIndex: null,
    turns: [],
    doneTurns: [],
    status: "streaming",
    model: null,
  };
  await act(async () => root.render(<ReadPage />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>("#fixture-stop")?.click(),
  );
  expect(state.stop).toHaveBeenCalledWith("active-answer");
});

it.each([
  "phone",
  "sidenotes",
])("renders a hydrated unplaced summary definition in its readable pane on %s", async (mode) => {
  state.marginMode = mode;
  state.thread = {
    id: "saved-summary",
    mode: "define",
    selection: "ascetic",
    paragraphIndex: null,
    summaryDefinition: true,
    turns: [{ role: "assistant", content: "Practicing self-denial." }],
    status: "done",
  };
  await act(async () => root.render(<ReadPage />));
  expect(document.querySelectorAll("#fixture-stop")).toHaveLength(1);
  expect(
    document.querySelector("#fixture-stop")?.getAttribute("data-readable-pane"),
  ).toBe("true");
});

it("suppresses floating Ask while word study owns the reader pane", async () => {
  state.bible = true;
  await act(async () => root.render(<ReadPage />));
  expect(document.querySelector("#fixture-ask")).not.toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>("#fixture-word-open")?.click(),
  );
  expect(
    document.querySelector('dialog[aria-label="Original-language word study"]'),
  ).not.toBeNull();
  expect(document.querySelector("#fixture-ask")).toBeNull();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Back to passage"]')
      ?.click(),
  );
  expect(document.querySelector("#fixture-ask")).not.toBeNull();
});
it("cycles split annotations once per identity with the paragraph shortcut", async () => {
  state.fragmented = true;
  await act(async () => root.render(<ReadPage />));
  for (let i = 0; i < 3; i++) {
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "o", bubbles: true }),
      ),
    );
  }
  expect(state.clicked).toEqual(["a1", "a2", "a1"]);
});
const keydown = (key: string) =>
  act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
it("moves a plain article by paragraph with j and k", async () => {
  state.html = "<p>First paragraph.</p><p>Second paragraph.</p>";
  window.scrollBy = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  await act(async () => {
    root.render(<ReadPage />);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await keydown("j");
  const cursor = () =>
    [...document.querySelectorAll("[data-keyboard-cursor]")].map(
      (el) => el.textContent,
    );
  expect(cursor()).toEqual(["First paragraph."]);
  await keydown("j");
  expect(cursor()).toEqual(["Second paragraph."]);
  await keydown("k");
  expect(cursor()).toEqual(["First paragraph."]);
});
it("moves a Bible reading by verse, painting the verse and leaving the paragraph cursor off", async () => {
  state.bible = true;
  state.html =
    '<div class="q1"><span class="yv-v" v="3"></span><span class="yv-vlbl">3</span><span>He restores my soul.</span></div>' +
    '<div class="q1"><span class="yv-v" v="4"></span><span class="yv-vlbl">4</span><span>Even though I walk </span></div>' +
    '<div class="q2"><span>through the valley</span><span class="yv-n">a footnote</span></div>';
  const painted = new Map<string, { ranges: Range[] }>();
  vi.stubGlobal(
    "Highlight",
    class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    },
  );
  vi.stubGlobal("CSS", { escape: (v: string) => v, highlights: painted });
  window.scrollBy = vi.fn();
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 100, 20),
  );
  await act(async () => {
    root.render(<ReadPage />);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const tint = () => painted.get("verse-cursor")?.ranges.map(String);
  await keydown("j");
  expect(tint()).toEqual(["He restores my soul."]);
  await keydown("j");
  expect(tint()).toEqual(["Even though I walk", "through the valley"]);
  expect(document.querySelector("[data-keyboard-cursor]")).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Psalms 23:4. Even though I walk through the valley",
  );
  await keydown("k");
  expect(tint()).toEqual(["He restores my soul."]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps sidenote measurement and observer identity unchanged when page reading progress updates", async () => {
  await act(async () => {
    root.render(<ReadPage />);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(
    document.querySelector('.sidenote[data-placed="true"]')?.textContent,
  ).toContain("A margin note.");
  const measure = vi.mocked(HTMLElement.prototype.getClientRects);
  measure.mockClear();
  const observers = state.observers;
  state.progress = 45;
  await act(async () => root.render(<ReadPage />));
  expect(
    document.querySelector<HTMLElement>(".reading-progress")?.style.width,
  ).toBe("45%");
  expect(measure).not.toHaveBeenCalled();
  expect(state.observers).toBe(observers);
});
