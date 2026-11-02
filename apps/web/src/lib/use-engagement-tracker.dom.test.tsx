// @vitest-environment happy-dom

import type { ReadingCheckpoint } from "@marginalia/backend/reading-activity";
import { cellWeights, coverageWords } from "@marginalia/backend/reading-pages";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerUnfold } from "@/components/note-unfold";
import type { PageCoverageConfig } from "./page-coverage";
import { useParagraphs } from "./paragraphs";
import { useEngagementTracker } from "./use-engagement-tracker";

class FakeObserver {
  static all: FakeObserver[] = [];
  observed: HTMLElement[] = [];
  disconnected = false;
  constructor(readonly callback: (entries: unknown[]) => void) {
    FakeObserver.all.push(this);
  }
  observe(el: HTMLElement) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  show(...labels: number[]) {
    const entries = this.observed
      .filter((el) => labels.includes(Number(el.dataset.para)))
      .map((target) => ({ target, isIntersecting: true }));
    this.callback(entries);
  }
}
const live = () => FakeObserver.all.filter((o) => !o.disconnected);
const labels = (o: FakeObserver) => o.observed.map((el) => el.dataset.para);

let root: Root;
let tracker: ReturnType<typeof useEngagementTracker>;
const checkpoint = vi.hoisted(() =>
  vi.fn(async (_input: ReadingCheckpoint) => null),
);
vi.mock("convex/react", () => ({ useMutation: () => checkpoint }));

function Reader({
  articleId,
  sessionId = null,
  sessionKey,
  pageSource,
  timeZone,
  text,
}: {
  articleId: string;
  sessionId?: string | null;
  sessionKey?: string;
  pageSource?: PageCoverageConfig;
  timeZone?: string;
  text?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const { version } = useParagraphs(ref, true);
  tracker = useEngagementTracker({
    articleId,
    sessionId,
    sessionKey,
    requestedMinutes: sessionKey ? 17 : undefined,
    ready: true,
    containerRef: ref,
    listening: false,
    paragraphVersion: version,
    pageSource,
    timeZone,
  });
  return (
    <>
      <article ref={ref}>
        <div data-article-body>
          <p>{text ?? "First paragraph of the piece."}</p>
          <p>Second paragraph of the piece.</p>
          <p>Third paragraph of the piece.</p>
        </div>
      </article>
      <AnswerUnfold
        containerRef={ref}
        version={version}
        id="answer"
        paragraphIndex={0}
      >
        <div>
          <p>An answer that is not part of the article.</p>
        </div>
      </AnswerUnfold>
    </>
  );
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const leave = async () => {
  sentBlobs = [];
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
  });
  return Promise.all(sentBlobs.map((b) => b.text().then((t) => JSON.parse(t))));
};
let sentBlobs: Blob[] = [];
let pendingStartupAck: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  FakeObserver.all = [];
  checkpoint.mockReset();
  checkpoint.mockResolvedValue(null);
  sentBlobs = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, blob: Blob) => {
      sentBlobs.push(blob);
      return true;
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => {
    pendingStartupAck?.();
    pendingStartupAck = undefined;
  });
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function visibleGeometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = Number(this.dataset.para ?? 0);
      return {
        top: 100 + index * 70,
        bottom: 150 + index * 70,
        height: 50,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: 0,
        toJSON() {},
      };
    },
  );
}

describe("paragraph dwell in the reader", () => {
  it("attaches late page coverage without another visit, time reset, or dwell observer replacement", async () => {
    await act(async () =>
      root.render(<Reader articleId="hydrated-pages" timeZone="UTC" />),
    );
    await advance(100);
    const previous = live()[0];
    previous.show(1);
    await advance(2000);
    const pageSource = {
      sourceId: "source",
      coverage: "0",
      paragraphWords: [5, 5, 5],
      timeZone: "UTC",
      goalWords: 3000,
    };
    await act(async () =>
      root.render(
        <Reader
          articleId="hydrated-pages"
          timeZone="UTC"
          pageSource={pageSource}
        />,
      ),
    );
    await advance(100);
    expect(previous.disconnected).toBe(false);
    await advance(2000);
    await act(async () => tracker.retry());
    const sent = checkpoint.mock.calls
      .map(([snapshot]) => snapshot)
      .filter((s) => s.articleId === "hydrated-pages");
    expect(new Set(sent.map((s) => s.visitId)).size).toBe(1);
    expect(new Set(sent.map((s) => s.startedAt)).size).toBe(1);
    expect(tracker.pageTrackingUnavailable).toBe(false);
    expect(sent.at(-1)?.pageCredit?.sourceId).toBe("source");
    expect(sent.at(-1)).toMatchObject({
      activeTimeMs: 4200,
      timeSpentMs: 4200,
      dwell: { "1": 4100 },
    });
  });
  it("keeps an in-flight startup identity across late preparation and account midnight while the device is in another zone", async () => {
    vi.stubEnv("TZ", "UTC");
    const start = Date.parse("2026-11-02T04:59:58Z");
    vi.setSystemTime(start);
    visibleGeometry();
    let acknowledge: (value: null) => void = () => {};
    pendingStartupAck = () => acknowledge(null);
    checkpoint.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          acknowledge = resolve;
        }),
    );
    await act(async () =>
      root.render(<Reader articleId="travel" timeZone="America/New_York" />),
    );
    await advance(1000);
    const startup = checkpoint.mock.calls.find(
      ([s]) => s.articleId === "travel",
    )?.[0];
    expect(startup).toMatchObject({ day: "2026-11-01", startedAt: start });
    const pageSource = {
      sourceId: "source",
      coverage: "0",
      paragraphWords: [5, 5, 5],
      timeZone: "America/New_York",
      goalWords: 3000,
    };
    await act(async () =>
      root.render(
        <Reader
          articleId="travel"
          timeZone="America/New_York"
          pageSource={pageSource}
        />,
      ),
    );
    await advance(2500);
    await act(async () => {
      acknowledge(null);
      await Promise.resolve();
    });
    await advance(1500);
    await act(async () => tracker.retry());
    await act(async () => tracker.retry());
    const sent = checkpoint.mock.calls
      .map(([s]) => s)
      .filter((s) => s.articleId === "travel");
    expect(new Set(sent.map((s) => s.visitId)).size).toBe(1);
    expect(
      sent
        .filter((s) => s.day === "2026-11-01")
        .every((s) => s.startedAt === start),
    ).toBe(true);
    expect(
      sent.find((s) => s.day === "2026-11-01" && s.timeSpentMs > 0)
        ?.timeSpentMs,
    ).toBe(2000);
    const today = sent.at(-1);
    expect(today).toMatchObject({
      day: "2026-11-02",
      startedAt: Date.parse("2026-11-02T05:00:00Z"),
      activeTimeMs: 3000,
      timeSpentMs: 3000,
    });
    expect(
      coverageWords(today?.pageCredit?.coverage ?? "", cellWeights([5, 5, 5])),
    ).toBe(10);
    expect(tracker.saveError).toBe(false);
  });
  it("keeps a failed queued startup, late coverage, retries and Done in the same human visit", async () => {
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    visibleGeometry();
    checkpoint.mockRejectedValueOnce(new Error("temporary startup failure"));
    await act(async () =>
      root.render(<Reader articleId="queued-preparation" timeZone="UTC" />),
    );
    await advance(1000);
    expect(tracker.saveError).toBe(true);
    const startup = checkpoint.mock.calls.find(
      ([s]) => s.articleId === "queued-preparation",
    )?.[0];
    const pageSource = {
      sourceId: "source",
      coverage: "0",
      paragraphWords: [5, 5, 5],
      timeZone: "UTC",
      goalWords: 3000,
    };
    await act(async () =>
      root.render(
        <Reader
          articleId="queued-preparation"
          timeZone="UTC"
          pageSource={pageSource}
        />,
      ),
    );
    await advance(4000);
    expect(
      checkpoint.mock.calls.filter(
        ([s]) => s.articleId === "queued-preparation",
      ),
    ).toHaveLength(1);
    await act(async () => tracker.retry());
    expect(tracker.saveError).toBe(false);
    await act(async () => tracker.finish());
    const sent = checkpoint.mock.calls
      .map(([s]) => s)
      .filter((s) => s.articleId === "queued-preparation");
    expect(
      sent.every(
        (s) =>
          s.visitId === startup?.visitId && s.startedAt === startup?.startedAt,
      ),
    ).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      activeTimeMs: 5000,
      timeSpentMs: 5000,
      finished: true,
    });
  });
  it("pauses unavailable or replaced manifests without losing earned coverage or creating new opens", async () => {
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    visibleGeometry();
    const text = Array.from({ length: 160 }, () => "original").join(" ");
    const pageSource = {
      sourceId: "source",
      coverage: "000000",
      paragraphWords: [160, 5, 5],
      timeZone: "UTC",
      goalWords: 3000,
    };
    await act(async () =>
      root.render(
        <Reader
          articleId="changed-pages"
          text={text}
          pageSource={pageSource}
        />,
      ),
    );
    await advance(5000);
    expect(tracker.pendingPageWords).toBe(16);
    await act(async () =>
      root.render(
        <Reader
          articleId="changed-pages"
          text={text.replaceAll("original", "changed")}
        />,
      ),
    );
    await advance(4000);
    expect(tracker.pendingPageWords).toBe(16);
    await act(async () =>
      root.render(
        <Reader
          articleId="changed-pages"
          text={text}
          pageSource={{ ...pageSource, sourceId: "different-source" }}
        />,
      ),
    );
    await advance(2000);
    expect(tracker.pageTrackingUnavailable).toBe(true);
    await act(async () => tracker.retry());
    const sent = checkpoint.mock.calls
      .map(([s]) => s)
      .filter((s) => s.articleId === "changed-pages");
    expect(new Set(sent.map((s) => s.visitId)).size).toBe(1);
    expect(sent.at(-1)?.activeTimeMs).toBe(11000);
    expect(
      coverageWords(
        sent.at(-1)?.pageCredit?.coverage ?? "",
        cellWeights([160, 5, 5]),
      ),
    ).toBe(16);
  });
  it("saves stationary first-screen fractional pages through the existing checkpoint without Done or scroll", async () => {
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const index = Number(this.dataset.para ?? 0);
        return {
          top: 100 + index * 70,
          bottom: 150 + index * 70,
          height: 50,
          left: 0,
          right: 300,
          width: 300,
          x: 0,
          y: 0,
          toJSON() {},
        };
      },
    );
    const pageSource = {
      sourceId: "source",
      coverage: "0",
      paragraphWords: [5, 5, 5],
      timeZone: "UTC",
      goalWords: 3000,
    };
    await act(async () =>
      root.render(<Reader articleId="pages" pageSource={pageSource} />),
    );
    await advance(100);
    await act(async () => window.dispatchEvent(new Event("resize")));
    await advance(5000);
    checkpoint.mockClear();
    await act(async () => tracker.retry());
    const page = checkpoint.mock.calls.at(-1)?.[0];
    expect(page?.finished).toBe(false);
    expect(
      coverageWords(page?.pageCredit?.coverage ?? "", cellWeights([5, 5, 5])),
    ).toBe(15);
    expect(tracker.pendingPageWords).toBe(0);
  });
  it("does not resend an acknowledged prior day on the next flush, while current-day progress remains cumulative", async () => {
    vi.setSystemTime(new Date(2026, 9, 12, 23, 59, 58));
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(2500);
    checkpoint.mockClear();
    await act(async () => tracker.retry());
    const first = checkpoint.mock.calls.map(([snapshot]) => snapshot);
    expect(first.map((snapshot) => snapshot.day)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    await advance(1000);
    checkpoint.mockClear();
    await act(async () => tracker.retry());
    expect(checkpoint).toHaveBeenCalledTimes(1);
    const current = checkpoint.mock.calls[0][0];
    expect(current.day).toBe("2026-10-13");
    expect(current.visitId).toBe(first[1].visitId);
    expect(current.activeTimeMs).toBeGreaterThan(first[1].activeTimeMs);
  });
  it("does not prune a prior day after a timeout, even if the old send later resolves", async () => {
    vi.setSystemTime(new Date(2026, 9, 12, 23, 59, 58));
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(2500);
    let resolve: (value: null) => void = () => {};
    checkpoint.mockImplementationOnce(
      () =>
        new Promise<null>((r) => {
          resolve = r;
        }),
    );
    const retry = tracker.retry();
    const rejected = expect(retry).rejects.toThrow("hasn't synced");
    await advance(5100);
    await rejected;
    await act(async () => {
      resolve(null);
      await Promise.resolve();
    });
    checkpoint.mockClear();
    await act(async () => tracker.retry());
    expect(checkpoint.mock.calls.map(([snapshot]) => snapshot.day)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    checkpoint.mockClear();
    await act(async () => tracker.retry());
    expect(checkpoint.mock.calls.map(([snapshot]) => snapshot.day)).toEqual([
      "2026-10-13",
    ]);
  });
  it("retains an unacknowledged finish for unload after a delivery deadline, including when the old mutation resolves late", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    let resolve: (value: null) => void = () => {};
    checkpoint.mockImplementationOnce(
      () =>
        new Promise<null>((r) => {
          resolve = r;
        }),
    );
    const finishing = tracker.finish();
    const rejected = expect(finishing).rejects.toThrow("hasn't synced");
    await advance(5100);
    await rejected;
    expect(tracker.saveError).toBe(true);
    const [beacon] = await leave();
    expect(beacon.finished).toBe(true);
    await act(async () => {
      resolve(null);
      await Promise.resolve();
    });
    expect(tracker.saveError).toBe(true);
    await act(async () => tracker.finish());
    expect(checkpoint.mock.calls.at(-1)?.[0]).toMatchObject({
      visitId: beacon.visitId,
      finished: true,
    });
    expect(tracker.saveError).toBe(false);
  });
  it("does not retry in the background while offline or hidden, and resumes when visible and online", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(30_100);
    expect(checkpoint).not.toHaveBeenCalled();
    await act(async () => {
      await expect(tracker.finish()).rejects.toThrow("Reconnect");
    });
    online.mockReturnValue(true);
    hidden.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("online")));
    await advance(30_000);
    expect(checkpoint).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(checkpoint).toHaveBeenCalled();
    expect(checkpoint.mock.calls.at(-1)?.[0].finished).toBe(true);
  });
  it("keeps one clock and visit when the background session ID arrives", async () => {
    const sessionKey = "2bffb0eb-fcc8-499f-b369-7c7f4c307290";
    await act(async () =>
      root.render(<Reader articleId="a" sessionKey={sessionKey} />),
    );
    await advance(100);
    const first = checkpoint.mock.calls[0][0];
    await advance(3000);
    await act(async () =>
      root.render(
        <Reader articleId="a" sessionId="resolved" sessionKey={sessionKey} />,
      ),
    );
    await act(async () => tracker.finish());
    const last = checkpoint.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      visitId: first.visitId,
      startedAt: first.startedAt,
      sessionKey,
      finished: true,
    });
    expect(last?.activeTimeMs).toBeGreaterThanOrEqual(2900);
  });
  it("uses the authenticated checkpoint mutation in foreground and waits for an acknowledged finish", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    expect(checkpoint).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    let resolve: () => void = () => {};
    checkpoint.mockImplementationOnce(
      () =>
        new Promise<null>((r) => {
          resolve = () => r(null);
        }),
    );
    let completed = false;
    const finishing = tracker.finish().then(() => {
      completed = true;
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(completed).toBe(false);
    expect(checkpoint.mock.calls.at(-1)?.[0]).toMatchObject({ finished: true });
    await act(async () => {
      resolve();
      await finishing;
    });
    expect(completed).toBe(true);
  });
  it("exposes failed Done instead of silently treating it as saved", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    checkpoint.mockRejectedValueOnce(new Error("not saved"));
    await act(async () => {
      await expect(tracker.finish()).rejects.toThrow("not saved");
    });
    expect(tracker.saveError).toBe(true);
    await act(async () => tracker.finish());
    expect(tracker.saveError).toBe(false);
  });
  it("observes only the article's own numbered paragraphs, never an unfolded answer", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    const [observer] = live();
    expect(labels(observer)).toEqual(["1", "2", "3"]);
    expect(
      document.querySelector("[data-marginalia-ui] p")?.textContent,
    ).toContain("An answer");
  });

  it("reports cumulative dwell for the paragraphs on screen, the same from the beacon on every leave", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    await act(async () => live()[0].show(1, 2));
    await advance(3000);
    const [first] = await leave();
    expect(first.dwell["1"]).toBeGreaterThanOrEqual(2900);
    expect(first.dwell["2"]).toBe(first.dwell["1"]);
    expect(first.dwell["3"]).toBeUndefined();
    const [again] = await leave();
    expect(again.dwell).toEqual(first.dwell);
  });

  it("drops the old observer when the article changes and starts clean", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    const old = live()[0];
    await act(async () => old.show(1));
    await advance(2000);
    await act(async () => root.render(<Reader articleId="b" />));
    await advance(100);
    expect(old.disconnected).toBe(true);
    // A queued delivery from the replaced observer, after navigation
    await act(async () => old.show(1, 2, 3));
    expect(live().every((o) => o !== old)).toBe(true);
    await advance(3000);
    const sent = await leave();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((s) => s.articleId === "b" && !s.dwell)).toBe(true);
  });

  it("stops observing on unmount", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    await act(async () => root.unmount());
    expect(live()).toHaveLength(0);
    root = createRoot(document.getElementById("root") as HTMLElement);
  });
});
