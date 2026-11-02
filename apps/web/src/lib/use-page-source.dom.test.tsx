// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { PageCoverageConfig } from "./page-coverage";
import { usePageSource } from "./use-page-source";

type PreparedSource = PageCoverageConfig | { unavailable: string };
const prepare = vi.hoisted(() => vi.fn<() => Promise<PreparedSource>>());
vi.mock("convex/react", () => ({ useMutation: () => prepare }));

it("removes an old manifest immediately while a new prose epoch is being validated, including unavailable results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const config = {
    sourceId: "source",
    coverage: "0",
    paragraphWords: [5],
    timeZone: "UTC",
    goalWords: 3000,
  };
  prepare.mockResolvedValueOnce(config);
  let result: ReturnType<typeof usePageSource> | undefined;
  function Probe({ version }: { version: number }) {
    const ref = useRef<HTMLElement>(null);
    // SAFETY: this test-owned ID reaches only the mocked preparation boundary.
    result = usePageSource({
      articleId: "fixture" as Id<"articles">,
      content: "First paragraph of the piece.",
      isBook: false,
      version,
      containerRef: ref,
    });
    return (
      <>
        <article ref={ref}>
          <div data-article-body>
            <p data-para="1">First paragraph of the piece.</p>
          </div>
        </article>
        <output>{result.config?.sourceId ?? "paused"}</output>
      </>
    );
  }
  let release: (value: PreparedSource) => void = () => {};
  try {
    await act(async () => root.render(<Probe version={1} />));
    expect(result?.config?.sourceId).toBe("source");
    prepare.mockImplementationOnce(
      () =>
        new Promise<PreparedSource>((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => root.render(<Probe version={2} />));
    expect(result?.config).toBeUndefined();
    expect(host.querySelector("output")?.textContent).toBe("paused");
    await act(async () => {
      release({ unavailable: "Updated text is not tracked yet." });
    });
    expect(result?.config).toBeUndefined();
    expect(result?.message).toBe("Updated text is not tracked yet.");
  } finally {
    release({ unavailable: "Stopped" });
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
