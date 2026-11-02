import { type FunctionReference, getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate, RequestAccess } from "./auth-gate";

const state = vi.hoisted(() => ({
  pathname: "/",
  loading: false,
  authenticated: false,
  reader: undefined as
    | { isOwner: boolean; email: string; name: string }
    | null
    | undefined,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: state.loading,
  }),
  useQuery: (reference: FunctionReference<"query">) =>
    getFunctionName(reference) === "auth:currentReader"
      ? state.reader
      : undefined,
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: vi.fn() }));

afterEach(() => {
  state.pathname = "/";
  state.loading = false;
  state.authenticated = false;
  state.reader = undefined;
});

describe("reader gate", () => {
  it.each([
    "/privacy",
    "/terms",
    "/help/deep-study",
  ])("shows %s without signing in or waiting for authentication", (pathname) => {
    state.pathname = pathname;
    state.loading = true;
    expect(renderToStaticMarkup(<AuthGate>public notice</AuthGate>)).toBe(
      "public notice",
    );
  });

  it.each([
    "/",
    "/library",
    "/account",
    "/privacy/other",
    "/terms/other",
    "/help/deep-study/other",
  ])("keeps %s protected", (pathname) => {
    state.pathname = pathname;
    const html = renderToStaticMarkup(<AuthGate>private library</AuthGate>);
    expect(html).not.toContain("private library");
    expect(html).toContain("Request access");
  });

  it("links the notices from sign-in and request-access footers", () => {
    for (const html of [
      renderToStaticMarkup(<AuthGate>desk</AuthGate>),
      renderToStaticMarkup(<RequestAccess onBack={() => {}} />),
    ]) {
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('aria-label="Legal"');
    }
  });

  it("lets approved readers in", () => {
    state.authenticated = true;
    state.reader = { isOwner: false, email: "r@example.com", name: "R" };
    expect(renderToStaticMarkup(<AuthGate>desk</AuthGate>)).toBe("desk");
  });

  it("explains why a disabled or unknown account can't enter", () => {
    state.authenticated = true;
    state.reader = null;
    const html = renderToStaticMarkup(<AuthGate>desk</AuthGate>);
    expect(html).not.toContain("desk");
    expect(html).toContain("No access right now");
    expect(html).toContain("Sign out");
  });

  it("offers a way to request access from the sign-in screen", () => {
    expect(renderToStaticMarkup(<AuthGate>desk</AuthGate>)).toContain(
      "Request access",
    );
    const form = renderToStaticMarkup(<RequestAccess onBack={() => {}} />);
    expect(form).toContain('name="email"');
    expect(form).toContain('name="name"');
    expect(form).toContain('maxLength="500"');
  });
});
