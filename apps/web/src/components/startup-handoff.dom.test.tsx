// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import DeskLayout from "@/app/(desk)/layout";
import DeskRoute from "@/app/(desk)/page";
import { consumeFinderRequest, requestFinder } from "@/lib/finder-request";
import { markFinished } from "@/lib/title-handoff";

const loading = vi.hoisted(() => ({
  desk: Promise.withResolvers<void>(),
  navigation: Promise.withResolvers<void>(),
}));
vi.mock("@/components/desk/desk", async () => {
  await loading.desk.promise;
  return {
    default: ({ fromFinish }: { fromFinish: boolean }) => (
      <h1 data-from-finish={fromFinish}>Your private desk</h1>
    ),
  };
});
vi.mock("@/components/account-menu", async () => {
  await loading.navigation.promise;
  return { AccountMenu: () => null };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: vi.fn() }));

afterEach(() => {
  markFinished(Number.NEGATIVE_INFINITY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reserves the mobile bar while chunks load and keeps a finish handoff through a slow first load", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  markFinished();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <DeskLayout>
          <DeskRoute />
        </DeskLayout>,
      ),
    );
    expect(container.textContent).toContain("Opening your desk");
    const placeholder = container.querySelector(
      '[aria-hidden="true"].md\\:hidden',
    );
    expect(placeholder?.className).toContain(
      "h-[calc(3.5rem+env(safe-area-inset-bottom)+1px)]",
    );
    now.mockReturnValue(7001);
    await act(async () => {
      loading.desk.resolve();
      loading.navigation.resolve();
      await vi.dynamicImportSettled();
    });
    expect(
      container.querySelector("h1")?.getAttribute("data-from-finish"),
    ).toBe("true");
    expect(container.querySelector(".mobile-app-nav")).not.toBeNull();
    expect(placeholder?.isConnected).toBe(false);
    // Simulate an intent not yet consumed by the real lazy finder.
    requestFinder();
    await act(async () => root.render(null));
    expect(consumeFinderRequest()).toBe(false);
    await act(async () =>
      root.render(
        <DeskLayout>
          <DeskRoute />
        </DeskLayout>,
      ),
    );
    expect(
      container.querySelector("h1")?.getAttribute("data-from-finish"),
    ).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
