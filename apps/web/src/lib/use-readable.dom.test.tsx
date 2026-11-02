// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useReadable } from "./use-book-reading";

type QueryCall = {
  name: string;
  args: { articleId: string; unitIndex?: number } | "skip";
};
const state = vi.hoisted(() => {
  const calls: QueryCall[] = [];
  return { ready: false, next: 2, blockExplicit: true, calls };
});
vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
  useAction: () => vi.fn(),
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: { articleId: string; unitIndex?: number } | "skip",
  ) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    if (args === "skip" || !state.ready) return undefined;
    if (name !== "readerBootstrap:get") return null;
    if (args.unitIndex !== undefined && state.blockExplicit) return undefined;
    const unitIndex = args.unitIndex ?? state.next;
    return {
      isBook: true,
      readingTimeZone: "America/New_York",
      unitIndex,
      unitKey: `unit-${unitIndex}`,
      article: { content: `Part ${unitIndex}` },
      missingUnit: false,
    };
  },
}));
it("gets readable text in the bootstrap query and keeps the chosen default readable while pinning its subscription", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  let readingTimeZone: string | undefined;
  function Probe() {
    // SAFETY: this test replaces the Convex boundary; the ID never reaches a server.
    const result = useReadable("fixture" as never, null);
    readingTimeZone = result.readingTimeZone;
    return <span>{result.article?.content ?? "Loading"}</span>;
  }
  await act(async () => root.render(<Probe />));
  expect(host.textContent).toBe("Loading");
  expect(
    state.calls
      .filter((c) => c.name !== "readerBootstrap:get")
      .every((c) => c.args === "skip"),
  ).toBe(true);
  state.ready = true;
  await act(async () => root.render(<Probe />));
  expect(host.textContent).toBe("Part 2");
  expect(readingTimeZone).toBe("America/New_York");
  // Progress changes what a fresh visit would choose; this visit stays on 2,
  // even while its narrowed text subscription has not returned yet.
  state.next = 3;
  await act(async () => root.render(<Probe />));
  expect(host.textContent).toBe("Part 2");
  expect(
    state.calls.filter((c) => c.name === "readerBootstrap:get").at(-1)?.args,
  ).toMatchObject({ unitIndex: 2 });
  await act(async () => root.unmount());
  host.remove();
});
