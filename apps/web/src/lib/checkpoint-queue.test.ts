import { expect, it, vi } from "vitest";
import {
  acknowledgeCheckpoint,
  drainCheckpoints,
  mergeCheckpoint,
  parseCheckpoints,
  queueCheckpoints,
} from "./checkpoint-queue";

const snapshot = {
  articleId: "fixture",
  visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
  day: "2026-10-12",
  startedAt: 1000,
  updatedAt: 11000,
  activeTimeMs: 6000,
  visibleTimeMs: 8000,
  timeSpentMs: 10000,
  maxScrollPercent: 40,
  annotationsOpened: ["one"],
};
it("never downgrades queued progress or completion when an older request retries", () => {
  const latest = {
    ...snapshot,
    updatedAt: 16000,
    activeTimeMs: 10000,
    visibleTimeMs: 13000,
    timeSpentMs: 15000,
    maxScrollPercent: 80,
    annotationsOpened: ["one", "two"],
    finished: true,
  };
  const queue = mergeCheckpoint([latest], snapshot);
  expect(queue).toEqual([latest]);
  expect(acknowledgeCheckpoint(queue, snapshot)).toEqual([latest]);
  expect(acknowledgeCheckpoint(queue, latest)).toEqual([]);
});

it("serializes drains, gives Done priority after an active send and preserves newer snapshots on acknowledgement", async () => {
  const store = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => {
    store.set(key, value);
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem,
  });
  vi.stubGlobal("navigator", { onLine: true });
  let release: () => void = () => {};
  const first = new Promise<void>((r) => {
    release = r;
  });
  const sent: (typeof snapshot)[] = [];
  const send = vi.fn(async (s: typeof snapshot) => {
    sent.push(s);
    if (sent.length === 1) await first;
  });
  const other = {
    ...snapshot,
    visitId: "270d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
  };
  queueCheckpoints([snapshot, other]);
  const background = drainCheckpoints(send);
  await Promise.resolve();
  await Promise.resolve();
  const finish = {
    ...snapshot,
    finished: true,
    annotationsOpened: ["one", "latest"],
  };
  queueCheckpoints([finish]);
  const done = drainCheckpoints(send, [finish]);
  expect(sent).toHaveLength(1);
  release();
  await Promise.all([background, done]);
  expect(sent).toEqual([snapshot, finish]);
  expect(parseCheckpoints(store.values().next().value ?? null)).toEqual([
    other,
  ]);
  await drainCheckpoints(send);
  expect(sent).toEqual([snapshot, finish, other]);
  expect(setItem).toHaveBeenCalledTimes(5); // batch enqueues + one ack per batch, not per entry
  vi.unstubAllGlobals();
});

it("keeps failed and offline finishes in memory even when localStorage is unavailable", async () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("private");
    },
    setItem() {
      throw new Error("private");
    },
  });
  vi.stubGlobal("navigator", { onLine: false });
  const finish = { ...snapshot, finished: true };
  queueCheckpoints([finish]);
  const send = vi.fn(async () => {});
  await expect(drainCheckpoints(send, [finish])).rejects.toThrow("Reconnect");
  expect(send).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", { onLine: true });
  const failed = vi.fn(async () => {
    throw new Error("refused");
  });
  await expect(drainCheckpoints(failed, [finish])).rejects.toThrow("refused");
  await drainCheckpoints(send);
  expect(send).toHaveBeenCalledWith(finish);
  vi.unstubAllGlobals();
});
it("retains same-timestamp annotation and finish updates until they too are acknowledged", () => {
  const updated = {
    ...snapshot,
    annotationsOpened: ["one", "two"],
    finished: true,
  };
  expect(acknowledgeCheckpoint([updated], snapshot)).toEqual([updated]);
});
it("keeps separate visits and days separate, discarding invalid stored payloads", () => {
  const nextDay = { ...snapshot, day: "2026-10-13" };
  expect(mergeCheckpoint([snapshot], nextDay)).toHaveLength(2);
  expect(
    parseCheckpoints(
      JSON.stringify([snapshot, { ...snapshot, activeTimeMs: -1 }]),
    ),
  ).toEqual([snapshot]);
});
it("merges queued dwell by the larger reading per paragraph and keeps it until acknowledged", () => {
  const first = { ...snapshot, dwell: { "1": 3000, "2": 1500 } };
  const later = { ...snapshot, dwell: { "1": 2000, "3": 4000 } };
  const [merged] = mergeCheckpoint([first], later);
  expect(merged.dwell).toEqual({ "1": 3000, "2": 1500, "3": 4000 });
  expect(mergeCheckpoint([merged], first)[0].dwell).toEqual(merged.dwell);
  expect(acknowledgeCheckpoint([merged], first)).toEqual([merged]);
  expect(acknowledgeCheckpoint([merged], merged)).toEqual([]);
});
it("still parses and merges checkpoints from before dwell existed", () => {
  expect(parseCheckpoints("corrupt legacy storage")).toEqual([]);
  const queue = parseCheckpoints(JSON.stringify([snapshot]));
  expect(queue).toEqual([snapshot]);
  expect(mergeCheckpoint(queue, snapshot)[0].dwell).toBeUndefined();
  expect(acknowledgeCheckpoint(queue, snapshot)).toEqual([]);
});
it("keeps the paragraph of the furthest queued scroll", () => {
  const ahead = { ...snapshot, maxScrollPercent: 80, paragraphIndex: 31 };
  const behind = { ...snapshot, updatedAt: 12000, paragraphIndex: 12 };
  expect(mergeCheckpoint([ahead], behind)[0].paragraphIndex).toBe(31);
  const further = { ...snapshot, maxScrollPercent: 90, paragraphIndex: 40 };
  expect(mergeCheckpoint([ahead], further)[0].paragraphIndex).toBe(40);
});
it("unions page coverage across stale checkpoints and preserves it through legacy deliveries", () => {
  const first = {
    ...snapshot,
    pageCredit: {
      sourceId: "source",
      coverage: "1",
      visualTimeMs: 3000,
      timeZone: "UTC",
      goalWords: 3000,
    },
  };
  const later = {
    ...first,
    pageCredit: { ...first.pageCredit, coverage: "3", visualTimeMs: 6000 },
  };
  const [merged] = mergeCheckpoint([later], first);
  expect(merged.pageCredit).toEqual(later.pageCredit);
  expect(mergeCheckpoint([merged], snapshot)[0].pageCredit).toEqual(
    later.pageCredit,
  );
  expect(acknowledgeCheckpoint([merged], first)).toEqual([merged]);
  expect(acknowledgeCheckpoint([merged], snapshot)).toEqual([merged]);
  expect(acknowledgeCheckpoint([merged], later)).toEqual([]);
});
