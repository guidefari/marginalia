// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadingPage from "./page";

const mocks = vi.hoisted(() => ({
  tab: null as string | null,
  todays: [] as (string | undefined)[],
  room: undefined as unknown,
  // SAFETY: this query slot is owned entirely by the fixed fixtures below, never external input.
  pageOverview: undefined as unknown,
  // SAFETY: this empty test capture receives only the typed optional numeric query argument.
  pageDays: [] as (number | undefined)[],
  topics: undefined as unknown,
  habits: undefined as unknown,
  linger: undefined as unknown,
  merges: undefined as unknown,
  accept: vi.fn(),
  keepBoth: vi.fn(),
  lookups: {
    results: [] as ReturnType<typeof lookup>[],
    status: "Exhausted" as string,
    loadMore: vi.fn(),
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (
    ref: string,
    args?: {
      today?: string;
      query?: string;
      letter?: string;
      wordKey?: string;
      days?: number;
    },
  ) => {
    if (ref === "room") mocks.todays.push(args?.today);
    if (ref === "pageOverview") mocks.pageDays.push(args?.days);
    const rows = mocks.lookups.results;
    const keys = [...new Set(rows.map((r) => r.wordKey))].sort();
    const letterOf = (key: string) =>
      key.normalize("NFD").replace(/\p{M}/gu, "").charAt(0).toUpperCase();
    if (ref === "dictionarySummary")
      return {
        total: keys.length,
        complete: true,
        month: 0,
        monthComplete: true,
        monthCursor: null,
        letters: [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => ({
          letter,
          hasWords: keys.some((key) => letterOf(key) === letter),
        })),
      };
    if (ref === "dictionaryHeadwords")
      return {
        page: keys
          .filter(
            (key) =>
              (!args?.letter || letterOf(key) === args.letter) &&
              (!args?.query ||
                key
                  .normalize("NFD")
                  .replace(/\p{M}/gu, "")
                  .includes(args.query)),
          )
          .slice(0, 40)
          .map((wordKey) => ({
            wordKey,
            letter: letterOf(wordKey),
            preview: rows
              .filter((r) => r.wordKey === wordKey)
              .sort((a, b) => a.createdAt - b.createdAt)[0].sense,
            occurrences: rows.filter((r) => r.wordKey === wordKey).length,
          })),
        done: mocks.lookups.status === "Exhausted",
        after: "next",
      };
    if (ref === "dictionarySenses")
      return {
        page: rows.filter((r) => r.wordKey === args?.wordKey).slice(0, 4),
        isDone: true,
        continueCursor: "",
      };
    return (mocks as never)[ref];
  },
  usePaginatedQuery: () => mocks.lookups,
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    stats: { readingRoom: "room", readingTopics: "topics" },
    readingPages: { overview: "pageOverview", setGoal: "setPageGoal" },
    readingHabits: { readingHabits: "habits", readingLinger: "linger" },
    dictionary: {
      page: "page",
      summary: "dictionarySummary",
      headwords: "dictionaryHeadwords",
      senses: "dictionarySenses",
      monthCount: "dictionaryMonthCount",
      preparePage: "preparePage",
    },
    tagMerge: { pending: "merges", accept: "accept", keepBoth: "keepBoth" },
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => mocks.tab }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const grid = (cells: [number, number][] = []) => {
  const g = new Array<number>(168).fill(0);
  for (const [slot, n] of cells) g[slot] = n;
  return g;
};
const split = { short: 0, middle: 0, long: 0 };
const room = (over: object = {}) => ({
  period: {},
  partial: false,
  readsPartial: false,
  activeTimeMs: 3 * 3_600_000,
  readingDays: 5,
  heat: grid([[7, 30]]),
  weekday: { short: 3, middle: 0, long: 1 },
  weekend: split,
  shortSlots: grid(),
  longSlots: grid(),
  feeds: [],
  ...over,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  expect(Intl.NumberFormat().resolvedOptions().locale).toBe("en-US");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.tab = null;
  mocks.todays = [];
  mocks.room = undefined;
  mocks.pageOverview = undefined;
  mocks.pageDays = [];
  mocks.topics = undefined;
  mocks.habits = undefined;
  mocks.linger = undefined;
  mocks.merges = undefined;
  mocks.accept = vi.fn().mockResolvedValue(null);
  mocks.keepBoth = vi.fn().mockResolvedValue(null);
  mocks.lookups = { results: [], status: "Exhausted", loadMore: vi.fn() };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = () => act(async () => root.render(<ReadingPage />));

describe("Your reading", () => {
  it("shows the independent estimated-page ledger high in Stats and follows the selected period", async () => {
    mocks.room = room();
    mocks.pageOverview = {
      today: "2026-11-02",
      timeZone: "UTC",
      trackedFrom: "2026-11-02",
      visible: true,
      goalWords: 3000,
      history: [{ day: "2026-11-02", creditedWords: 150, goalWords: 3000 }],
    };
    await render();
    expect(container.textContent).toContain("0.5 of 10 pages today");
    expect(container.textContent).toContain("Not tracked");
    expect(mocks.pageDays).toContain(31);
    const select = container.querySelector("select");
    if (!select) throw new Error("Missing Stats period");
    await act(async () => {
      select.value = "90days";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.pageDays.at(-1)).toBe(90);
    expect(container.querySelectorAll("ol li")).toHaveLength(90);
  });
  it("opens on the stats with one sentence and tabs that carry the tab in the URL", async () => {
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("Your reading");
    expect(container.textContent).toContain(
      "This month you read for 3 hours over 5 days",
    );
    const hrefs = [...container.querySelectorAll("nav a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/reading", "/reading?tab=dictionary"]);
    expect(container.querySelector("nav a[aria-current]")?.textContent).toBe(
      "Your reading",
    );
  });

  it("says there is no reading yet for an empty month and still renders calmly", async () => {
    mocks.room = room({ activeTimeMs: 0, readingDays: 0, heat: grid() });
    mocks.topics = [];
    await render();
    expect(container.textContent).toContain("No reading yet this month.");
    expect(container.textContent).toContain("Nothing to show for this period");
    expect(container.textContent).toContain("No feed has offered you anything");
  });

  it("hides the topics block until some article has a topic", async () => {
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(container.textContent).not.toContain("The topics you return to");
    mocks.topics = [
      { name: "attention", minutes: 120, articles: 4, finished: 0, skipped: 0 },
    ];
    await render();
    expect(container.textContent).toContain("The topics you return to");
    expect(container.textContent).toContain("attention");
    expect(container.textContent).toContain("2h · 4 articles");
  });

  it("says what was finished and skipped under a topic, and nothing when there is none", async () => {
    mocks.room = room();
    mocks.topics = [
      { name: "attention", minutes: 120, articles: 4, finished: 3, skipped: 1 },
      { name: "hiring", minutes: 60, articles: 2, finished: 0, skipped: 2 },
      { name: "quiet", minutes: 30, articles: 1, finished: 0, skipped: 0 },
    ];
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("3 finished · 1 skipped");
    expect(text).toContain("2 skipped");
    expect(text).not.toContain("0 finished");
    expect(text).not.toContain("0 skipped");
  });

  it("opens Library on a topic when it is clicked in the topic map", async () => {
    mocks.room = room();
    mocks.topics = [
      { name: "deep work", minutes: 120, articles: 4, finished: 0, skipped: 0 },
    ];
    await render();
    const link = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "deep work",
    );
    expect(link?.getAttribute("href")).toBe("/library?topic=deep%20work");
  });

  it("shows where the reader lingers and how they read, every number in text", async () => {
    mocks.room = room();
    mocks.topics = [];
    mocks.linger = {
      topics: [
        {
          name: "attention",
          secondsPerParagraph: 12.5,
          paragraphs: 40,
          articles: 3,
        },
      ],
      partial: true,
    };
    mocks.habits = {
      timesChosen: [
        { minutes: 5, count: 3 },
        { minutes: 20, count: 1 },
      ],
      anotherPresses: 7,
      finishes: 1,
      leftUnfinished: 2,
      partial: false,
    };
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("Where you linger");
    expect(text).toContain("attention");
    expect(text).toContain("12.5 s a paragraph · 40 paragraphs");
    expect(text).toContain("How you read");
    expect(text).toContain("5 min × 3 · 20 min × 1");
    expect(text).toContain("7 presses");
    expect(text).toContain(
      "Where you linger counts your most recent activity only.",
    );
    expect(text).toContain("1 article");
    expect(text).toContain("2 articles");
  });

  it("shows nothing for how they read until the counts arrive", async () => {
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(container.textContent).not.toContain("How you read");
    expect(container.textContent).not.toContain("Where you linger");
  });

  it("points a skipped feed to Sources and offers no other action", async () => {
    mocks.room = room({
      feeds: [
        {
          feedId: "f1",
          title: "A daily digest",
          offered: 60,
          opened: 3,
          finished: 0,
          skipsMost: true,
        },
        {
          feedId: "f2",
          title: "An essays feed",
          offered: 40,
          opened: 26,
          finished: 20,
          skipsMost: false,
        },
      ],
    });
    mocks.topics = [];
    await render();
    const hints = [...container.querySelectorAll("a")].filter((a) =>
      a.textContent?.includes("you skip most of this"),
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].getAttribute("href")).toBe("/feeds");
    expect(container.textContent).toContain("60 · 3 · 0");
  });
});

describe("two tags that look like one topic", () => {
  const suggestion = (over: object = {}) => ({
    suggestionId: "s1",
    into: "llm",
    from: "llms",
    strong: true,
    merging: false,
    ...over,
  });
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === name,
    );

  beforeEach(() => {
    mocks.room = room();
    mocks.topics = [
      { name: "llm", minutes: 120, articles: 4, finished: 0, skipped: 0 },
      { name: "llms", minutes: 60, articles: 2, finished: 0, skipped: 0 },
      { name: "attention", minutes: 90, articles: 3, finished: 0, skipped: 0 },
    ];
  });

  it("says so under the topics, underlines both names, and acts on neither", async () => {
    mocks.merges = [suggestion()];
    await render();
    expect(container.textContent).toContain(
      "llm and llms look like the same topic.",
    );
    expect(button("Merge into llm")).toBeDefined();
    expect(button("Keep both")).toBeDefined();
    const underlined = [...container.querySelectorAll("li")]
      .filter((li) => li.className.includes("underline"))
      .map((li) => li.firstChild?.textContent);
    expect(underlined).toEqual(["llm", "llms"]);
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.keepBoth).not.toHaveBeenCalled();
  });

  it("Merge into asks for that merge, and Keep both for that one", async () => {
    mocks.merges = [suggestion()];
    await render();
    await act(async () => button("Merge into llm")?.click());
    expect(mocks.accept).toHaveBeenCalledWith({ suggestionId: "s1" });
    await act(async () => button("Keep both")?.click());
    expect(mocks.keepBoth).toHaveBeenCalledWith({ suggestionId: "s1" });
  });

  it("shows a merge in progress without the buttons", async () => {
    mocks.merges = [suggestion({ merging: true })];
    await render();
    expect(container.textContent).toContain("Merging…");
    expect(button("Merge into llm")).toBeUndefined();
  });

  it("says nothing when there is no suggestion", async () => {
    mocks.merges = [];
    await render();
    expect(container.textContent).not.toContain("look like the same topic");
    expect(
      [...container.querySelectorAll("li")].some((li) =>
        li.className.includes("underline"),
      ),
    ).toBe(false);
  });
});

const lookup = (over: object) => ({
  _id: `l-${Math.random()}`,
  articleId: "art1",
  articleTitle: "On boring infrastructure",
  articleGone: false,
  word: "elastic",
  wordKey: "elastic",
  sentence: "the queue stays elastic under load",
  paragraphIndex: 4,
  sense: "adj. able to stretch to meet demand",
  createdAt: new Date(2026, 0, 3).getTime(),
  ...over,
});

describe("Your reading at midnight", () => {
  afterEach(() => vi.useRealTimers());

  it("asks again with the new date when the day rolls over while the room is open", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 30));
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(mocks.todays.at(-1)).toBe("2026-10-31");
    await act(async () => vi.advanceTimersByTime(40_000));
    expect(mocks.todays.at(-1)).toBe("2026-11-01");
  });

  it("refreshes the date when the tab becomes visible again", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 30, 12));
    mocks.room = room();
    mocks.topics = [];
    await render();
    vi.setSystemTime(new Date(2026, 10, 2, 8));
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(mocks.todays.at(-1)).toBe("2026-11-02");
  });
});

describe("Dictionary", () => {
  beforeEach(() => {
    mocks.tab = "dictionary";
  });

  it("invites the first lookup when the library is empty", async () => {
    await render();
    expect(container.textContent).toContain("No words yet");
    expect(container.querySelector("input")).toBeNull();
  });

  it("lays words out alphabetically with senses, links, a deleted article and a dimmed thumb index", async () => {
    mocks.lookups.results = [
      lookup({
        _id: "z",
        word: "zeal",
        wordKey: "zeal",
        sense: "n. eagerness",
      }),
      lookup({
        _id: "e2",
        sense: "v. to stretch",
        sentence: "elastic bands",
        createdAt: new Date(2026, 1, 3).getTime(),
      }),
      lookup({ _id: "e1" }),
      lookup({
        _id: "g",
        word: "ergodic",
        wordKey: "ergodic",
        articleTitle: null,
        articleGone: true,
        sense: "adj. averaged over time",
      }),
    ];
    await render();
    const headwords = [...container.querySelectorAll("h3")].map(
      (h) => h.textContent,
    );
    expect(headwords).toEqual(["elastic", "ergodic", "zeal"]);

    await act(async () =>
      container.querySelector<HTMLButtonElement>("article button")?.click(),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("3 words");
    // Two senses of one word are numbered, with the sentence in italic
    expect(text).toContain("able to stretch to meet demand");
    expect(text).toContain("to stretch");
    // The article links to the line; a deleted article keeps its entry without a link
    const link = [...container.querySelectorAll("article a")].find(
      (a) => a.textContent === "On boring infrastructure",
    );
    expect(link?.getAttribute("href")).toBe(
      "/read/art1?quote=the+queue+stays+elastic+under+load&p=4",
    );
    const goneEntry = [...container.querySelectorAll("article")].find(
      (a) => a.querySelector("h3")?.textContent === "ergodic",
    );
    await act(async () => goneEntry?.querySelector("button")?.click());
    expect(container.textContent).toContain(
      "Article no longer in your library",
    );

    const thumb = container.querySelector("nav[aria-label='Jump to a letter']");
    const buttons = [
      ...(thumb?.querySelectorAll("button:not(:disabled)") ?? []),
    ].map((b) => b.textContent);
    expect(buttons).toEqual(["E", "Z"]);
    expect(thumb?.querySelectorAll("button:disabled")).toHaveLength(24);
    // Guide words head each column
    expect(container.querySelector("h2")?.textContent).toContain(
      "elastic — ergodic",
    );
  });

  it("links an entry whose title the server left out, without calling it deleted", async () => {
    mocks.lookups.results = [lookup({ _id: "u", articleTitle: null })];
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("article button")?.click(),
    );
    const link = container.querySelector("article a");
    expect(link?.textContent).toBe("Open article");
    expect(container.textContent).not.toContain("no longer in your library");
  });

  it("jumps to a letter", async () => {
    mocks.lookups.results = [
      lookup({ _id: "a" }),
      lookup({ _id: "z", word: "zeal", wordKey: "zeal" }),
    ];
    await render();
    const scroll = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Element.prototype.scrollIntoView = scroll;
    const target = document.getElementById("letter-Z");
    expect(target).not.toBeNull();
    (target as HTMLElement).scrollIntoView = scroll;
    const z = [...container.querySelectorAll("nav button")].find(
      (b) => b.textContent === "Z",
    );
    await act(async () => (z as HTMLElement).click());
    expect(scroll).toHaveBeenCalled();
  });

  it("filters by what is typed and says so when nothing matches", async () => {
    mocks.lookups.results = [
      lookup({ _id: "a" }),
      lookup({ _id: "b", word: "épistémique", wordKey: "épistémique" }),
      lookup({ _id: "c", word: "zeal", wordKey: "zeal" }),
    ];
    await render();
    const input = container.querySelector("input") as HTMLInputElement;
    const type = async (value: string) =>
      act(async () => {
        const set = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("epist");
    expect(
      [...container.querySelectorAll("h3")].map((h) => h.textContent),
    ).toEqual(["épistémique"]);
    await type("qq");
    expect(container.textContent).toContain("No word or sense contains “qq”.");
  });

  it("never drains older lookups automatically, even with more than 2000 words", async () => {
    mocks.lookups.results = [lookup({ _id: "a" })];
    mocks.lookups.status = "CanLoadMore";
    await render();
    expect(mocks.lookups.loadMore).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Next words");

    mocks.lookups.loadMore.mockClear();
    mocks.lookups.results = Array.from({ length: 2000 }, (_, i) =>
      lookup({ _id: `w${i}`, word: `w${i}`, wordKey: `w${i}` }),
    );
    await render();
    expect(mocks.lookups.loadMore).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2000 words");
    expect(container.querySelectorAll("article")).toHaveLength(40);
  });
});
