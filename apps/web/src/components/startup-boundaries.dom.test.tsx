// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DeskLayout from "@/app/(desk)/layout";
import DeskRoute from "@/app/(desk)/page";
import { AuthGate } from "./auth-gate";

const state: {
  loading: boolean;
  authenticated: boolean;
  reader: { isOwner: boolean } | null | undefined;
  navigationLoaded: ReturnType<typeof vi.fn>;
  deskLoaded: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  loading: true,
  authenticated: false,
  reader: undefined,
  navigationLoaded: vi.fn(),
  deskLoaded: vi.fn(),
}));
vi.mock("@/components/account-menu", () => {
  state.navigationLoaded();
  return { AccountMenu: () => <button type="button">Account menu</button> };
});
vi.mock("@/components/desk/desk", () => {
  state.deskLoaded();
  return { default: () => <h1>Your private desk</h1> };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isLoading: state.loading,
    isAuthenticated: state.authenticated,
  }),
  useQuery: () => state.reader,
  useMutation: () => vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: vi.fn() }));
vi.mock("./page-goal", () => ({ PageGoalCelebration: () => null }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("does not load desk modules until the session and reader access are confirmed", async () => {
  const render = () =>
    act(async () =>
      root.render(
        <AuthGate>
          <DeskLayout>
            <DeskRoute />
          </DeskLayout>
        </AuthGate>,
      ),
    );
  await render();
  expect(container.textContent).toContain("Opening your reader");
  expect(state.navigationLoaded).not.toHaveBeenCalled();
  expect(state.deskLoaded).not.toHaveBeenCalled();

  state.loading = false;
  await render();
  expect(container.textContent).toContain("Your reading desk");
  expect(state.navigationLoaded).not.toHaveBeenCalled();
  expect(state.deskLoaded).not.toHaveBeenCalled();

  state.authenticated = true;
  await render();
  expect(container.textContent).toContain("Opening your reader");
  expect(state.navigationLoaded).not.toHaveBeenCalled();
  expect(state.deskLoaded).not.toHaveBeenCalled();
  state.reader = null;
  await render();
  expect(container.textContent).toContain("No access right now");
  expect(state.navigationLoaded).not.toHaveBeenCalled();
  expect(state.deskLoaded).not.toHaveBeenCalled();

  state.reader = { isOwner: false };
  await render();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(container.textContent).toContain("Your private desk");
  expect(state.navigationLoaded).toHaveBeenCalledTimes(1);
  expect(state.deskLoaded).toHaveBeenCalledTimes(1);
});
