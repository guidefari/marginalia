// @vitest-environment happy-dom

import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberTitle } from "@/lib/title-handoff";
import {
  ALREADY_SIGNED_IN,
  AuthGate,
  reloadOnce,
  takeFragmentTokens,
} from "./auth-gate";

const state = vi.hoisted(() => ({
  authenticated: false,
  reader: undefined as { isOwner: boolean } | null | undefined,
  queries: vi.fn(),
  mutate: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: false,
  }),
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference);
    state.queries(name, args);
    if (name === "auth:currentReader") return state.reader;
    if (
      name === "readingPages:overview" &&
      (!state.authenticated || !state.reader)
    )
      throw new Error(
        "Protected overview started without reader authorization",
      );
    return undefined;
  },
  useMutation: () => state.mutate,
}));
vi.mock("sonner", () => ({ toast }));
const session = vi.hoisted(() => ({ data: null as object | null }));
const rearm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: signUp },
    signIn: {},
    useSession: () => ({ data: session.data }),
  },
}));
vi.mock("@/lib/auth-retry", () => ({ rearmAuth: rearm }));
vi.mock("@/lib/reader-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reader-settings")>();
  return {
    ...actual,
    useReaderSettings: () => ({
      settings: { ...actual.DEFAULT_SETTINGS, theme: "ink" },
    }),
  };
});
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: vi.fn() }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  state.authenticated = false;
  state.reader = undefined;
  session.data = null;
  history.replaceState(null, "", "/");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("one-time tokens in the URL", () => {
  it.each([
    "/privacy",
    "/terms",
    "/help/deep-study",
  ])("keeps %s public for authenticated disabled or unapproved accounts without page queries", async (pathname) => {
    state.authenticated = true;
    state.reader = null;
    history.replaceState(null, "", pathname);
    await act(async () =>
      root.render(<AuthGate>Public legal or help content</AuthGate>),
    );
    expect(document.body.textContent).toBe("Public legal or help content");
    expect(
      state.queries.mock.calls.filter(([name]) =>
        name.startsWith("readingPages:"),
      ),
    ).toEqual([]);
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("keeps the reader-shaped loading state without mounting private content before authorization", async () => {
    state.authenticated = true;
    history.replaceState(null, "", "/read/private-article");
    rememberTitle("private-article", "Previously seen private title");
    await act(async () =>
      root.render(<AuthGate>Private article text</AuthGate>),
    );
    expect(document.querySelector("article")).not.toBeNull();
    expect(
      document.querySelector('[data-testid="reader-body-skeleton"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Opening your reader");
    expect(document.body.textContent).not.toContain("Private article text");
    expect(document.body.textContent).not.toContain(
      "Previously seen private title",
    );
    state.reader = { isOwner: true };
    await act(async () =>
      root.render(<AuthGate>Private article text</AuthGate>),
    );
    expect(document.body.textContent).toBe("Private article text");
    expect(
      state.queries.mock.calls.some(
        ([name, args]) => name === "readingPages:overview" && args !== "skip",
      ),
    ).toBe(true);
  });
  it("takes both tokens and keeps the path and query", () => {
    history.replaceState(null, "", "/library?view=all#invite=abc&setup=def");
    expect(takeFragmentTokens(window)).toEqual({
      invite: "abc",
      setup: "def",
    });
    expect(location.pathname + location.search + location.hash).toBe(
      "/library?view=all",
    );
  });

  it("leaves other fragments alone", () => {
    history.replaceState(null, "", "/notes#section-2");
    expect(takeFragmentTokens(window)).toEqual({ invite: "", setup: "" });
    expect(location.hash).toBe("#section-2");
  });

  it("strips an invite while signed in, says so, and never uses it", async () => {
    state.authenticated = true;
    state.reader = { isOwner: false };
    history.replaceState(null, "", "/saved?x=1#invite=secret-invite");
    await act(async () => root.render(<AuthGate>desk</AuthGate>));
    expect(location.href).not.toContain("secret-invite");
    expect(location.pathname + location.search).toBe("/saved?x=1");
    expect(document.body.textContent).toBe("desk");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(ALREADY_SIGNED_IN);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("strips a setup link while signed in without a notice", async () => {
    state.authenticated = true;
    state.reader = { isOwner: true };
    history.replaceState(null, "", "/#setup=secret-setup");
    await act(async () => root.render(<AuthGate>desk</AuthGate>));
    expect(location.href).not.toContain("secret-setup");
    expect(toast).not.toHaveBeenCalled();
  });

  it("strips an invite when signed out and opens the sign-up form with it", async () => {
    history.replaceState(null, "", "/#invite=secret-invite");
    await act(async () => root.render(<AuthGate>desk</AuthGate>));
    expect(location.href).not.toContain("secret-invite");
    expect(document.body.textContent).toContain("Set up your reader");
    expect(document.querySelector('input[name="name"]')).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("a lost token is not a sign-out", () => {
  it("offers to reconnect, not to sign in, while a session exists", async () => {
    session.data = { session: { id: "s" } };
    await act(async () => root.render(<AuthGate>reading</AuthGate>));
    expect(document.body.textContent).toContain("Reconnecting to your library");
    expect(document.body.textContent).not.toContain("Sign in");
    expect(
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Try again",
      ),
    ).toBe(true);
  });

  it("retries once by itself after a moment", async () => {
    vi.useFakeTimers();
    session.data = { session: { id: "s" } };
    await act(async () => root.render(<AuthGate>reading</AuthGate>));
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(rearm).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("still shows sign-in when there is no session", async () => {
    await act(async () => root.render(<AuthGate>reading</AuthGate>));
    expect(document.body.textContent).not.toContain("Reconnecting");
  });
});

describe("reloading a refused connection", () => {
  it("reloads once, then not again within a minute", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const reload = vi.fn();
    expect(reloadOnce(storage, reload, 1_000_000)).toBe(true);
    expect(reloadOnce(storage, reload, 1_030_000)).toBe(false);
    expect(reloadOnce(storage, reload, 1_070_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
