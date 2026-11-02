import { type FunctionReference, getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesList } from "@/components/notes-list";
import FeedsPage from "./feeds/page";
import DeskLayout from "./layout";
import LibraryPage from "./library/page";
import NotesPage from "./notes/page";
import HomePage from "./page";
import ReadingPage from "./reading/page";
import SavedPage from "./saved/page";

interface NoteFixture {
  _id: string;
  articleId: string;
  selectedText: string;
  content: string;
  contentPlain: string;
  createdAt: number;
}

const state: {
  notes: NoteFixture[] | undefined;
  pathname: string;
  isOwner: boolean;
} = vi.hoisted(() => ({
  notes: undefined,
  pathname: "/notes",
  isOwner: false,
}));
const applyTheme = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  },
}));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: applyTheme }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: FunctionReference<"query">) => {
    switch (getFunctionName(ref)) {
      case "userNotes:listAll":
        return state.notes;
      case "companionThreads:listKept":
        return [];
      case "savedArticles:count":
        return 1;
      case "articleMetadata:headers":
        return [
          {
            articleId: "article1",
            article: {
              title: "An article I read",
              url: "https://example.test",
            },
          },
        ];
      case "auth:currentReader":
        return { isOwner: state.isOwner, email: "r@example.com", name: "R" };
      default:
        return undefined;
    }
  },
  useConvex: () => ({ prewarmQuery: vi.fn() }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  usePaginatedQuery: (ref: FunctionReference<"query">) => ({
    results:
      getFunctionName(ref) === "userNotes:listPreviews"
        ? (state.notes ?? [])
        : [],
    status:
      getFunctionName(ref) === "userNotes:listPreviews" &&
      state.notes === undefined
        ? "LoadingFirstPage"
        : "Exhausted",
    loadMore: vi.fn(),
  }),
}));

describe("Reading desk navigation", () => {
  beforeEach(() => {
    state.notes = undefined;
    state.pathname = "/notes";
    state.isOwner = false;
    applyTheme.mockClear();
  });

  it.each([
    "loading",
    "empty",
    "populated",
  ])("keeps the shared navigation and reader theme when %s", (status) => {
    state.notes =
      status === "loading"
        ? undefined
        : status === "empty"
          ? []
          : [
              {
                _id: "note1",
                articleId: "article1",
                selectedText: "A passage I saved",
                content: "<p>My existing note</p>",
                contentPlain: "My existing note",
                createdAt: 1700000000000,
              },
            ];
    const html = renderToStaticMarkup(
      <DeskLayout>
        <NotesPage />
      </DeskLayout>,
    );
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    for (const path of ["/library", "/notes", "/reading"]) {
      expect(header).toContain(`href="${path}"`);
    }
    expect(header).toContain('aria-current="page"');
    expect(header.match(/aria-current="page"/g)).toHaveLength(1);
    expect(applyTheme).toHaveBeenCalledWith({ theme: "ink" });
    // Notes opens on the map; the list is one click away and keeps today's rows
    if (status === "populated") {
      const list = renderToStaticMarkup(<NotesList />);
      expect(list).toContain("My existing note");
      expect(list).toContain('href="/read/article1"');
    }
  });

  it.each([
    ["/", HomePage],
    ["/library", LibraryPage],
    ["/notes", NotesPage],
    ["/reading", ReadingPage],
    ["/feeds", FeedsPage],
  ] as const)("renders one shared shell around %s", (pathname, Page) => {
    state.pathname = pathname;
    const html = renderToStaticMarkup(
      <DeskLayout>
        <Page />
      </DeskLayout>,
    );
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain("h-dvh flex flex-col overflow-hidden");
    expect(html).not.toContain("← Back");
    expect(applyTheme).toHaveBeenCalledTimes(1);
  });

  it("shows four rooms and no retired links in the header", () => {
    const html = renderToStaticMarkup(
      <DeskLayout>
        <NotesPage />
      </DeskLayout>,
    );
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain(">Your reading<");
    expect(header).not.toMatch(/href="\/(saved|feeds|readers)"/);
    expect(header).not.toContain("This week");
    expect(header).not.toContain("Saved");
    expect(header).not.toContain("Sources");
    expect(header).not.toContain("Keyboard shortcuts");
    expect(header).not.toContain("Install Marginalia");
    expect(header).not.toContain("github.com");
  });

  it.each([
    false,
    true,
  ])("shows four phone slots, with Readers only in the avatar menu (owner %s)", (isOwner) => {
    state.isOwner = isOwner;
    const html = renderToStaticMarkup(
      <DeskLayout>
        <NotesPage />
      </DeskLayout>,
    );
    const mobile =
      html.match(/<nav[^>]*mobile-app-nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(mobile.match(/<a /g)).toHaveLength(3);
    expect(mobile).toContain(">Search<");
    expect(mobile).toContain("grid-cols-4");
    expect(mobile).not.toContain('href="/readers"');
    expect(mobile).not.toContain('href="/feeds"');
  });

  it("sends /saved to the Saved shelf", () => {
    let digest = "";
    try {
      SavedPage();
    } catch (error) {
      digest = String((error as { digest?: string }).digest);
    }
    expect(digest).toBe("NEXT_REDIRECT;replace;/library?shelf=saved;307;");
  });
});
