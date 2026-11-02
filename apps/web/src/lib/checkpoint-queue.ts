import {
  furthestParagraph,
  mergeDwell,
  mergePageCredit,
  type ReadingCheckpoint,
  readingCheckpointSchema,
} from "@marginalia/backend/reading-activity";

export function parseCheckpoints(raw: string | null): ReadingCheckpoint[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed = readingCheckpointSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}
const sameVisitDay = (a: ReadingCheckpoint, b: ReadingCheckpoint) =>
  a.visitId === b.visitId &&
  a.day === b.day &&
  a.articleId === b.articleId &&
  a.startedAt === b.startedAt;

export function mergeCheckpoint(
  queue: ReadingCheckpoint[],
  snapshot: ReadingCheckpoint,
) {
  const old = queue.find((entry) => sameVisitDay(entry, snapshot));
  const merged = old
    ? {
        ...old,
        sessionId: snapshot.sessionId ?? old.sessionId,
        sessionKey: snapshot.sessionKey ?? old.sessionKey,
        requestedMinutes: snapshot.requestedMinutes ?? old.requestedMinutes,
        updatedAt: Math.max(old.updatedAt, snapshot.updatedAt),
        activeTimeMs: Math.max(old.activeTimeMs, snapshot.activeTimeMs),
        visibleTimeMs: Math.max(old.visibleTimeMs, snapshot.visibleTimeMs),
        timeSpentMs: Math.max(old.timeSpentMs, snapshot.timeSpentMs),
        maxScrollPercent: Math.max(
          old.maxScrollPercent,
          snapshot.maxScrollPercent,
        ),
        paragraphIndex: furthestParagraph(old, snapshot),
        annotationsOpened: [
          ...new Set([...old.annotationsOpened, ...snapshot.annotationsOpened]),
        ].slice(0, 128),
        finished: old.finished || snapshot.finished,
        dwell: mergeDwell(old.dwell, snapshot.dwell),
        pageCredit: mergePageCredit(old.pageCredit, snapshot.pageCredit),
      }
    : snapshot;
  return [
    ...queue.filter((entry) => !sameVisitDay(entry, snapshot)),
    merged,
  ].slice(-64);
}
const dwellAhead = (
  entry: Record<string, number> | undefined,
  sent: Record<string, number> | undefined,
) => Object.entries(entry ?? {}).some(([key, ms]) => ms > (sent?.[key] ?? 0));

export function acknowledgeCheckpoint(
  queue: ReadingCheckpoint[],
  sent: ReadingCheckpoint,
) {
  return queue.filter(
    (entry) =>
      !sameVisitDay(entry, sent) ||
      entry.sessionId !== sent.sessionId ||
      entry.sessionKey !== sent.sessionKey ||
      entry.updatedAt > sent.updatedAt ||
      entry.activeTimeMs > sent.activeTimeMs ||
      entry.visibleTimeMs > sent.visibleTimeMs ||
      entry.timeSpentMs > sent.timeSpentMs ||
      entry.maxScrollPercent > sent.maxScrollPercent ||
      (entry.paragraphIndex !== undefined &&
        entry.paragraphIndex !== sent.paragraphIndex) ||
      entry.annotationsOpened.some(
        (id) => !sent.annotationsOpened.includes(id),
      ) ||
      dwellAhead(entry.dwell, sent.dwell) ||
      (entry.pageCredit !== undefined &&
        (sent.pageCredit?.sourceId !== entry.pageCredit.sourceId ||
          mergePageCredit(entry.pageCredit, sent.pageCredit)?.coverage !==
            sent.pageCredit.coverage ||
          entry.pageCredit.visualTimeMs > sent.pageCredit.visualTimeMs)) ||
      (entry.finished && !sent.finished),
  );
}

// V2 prevents a stale V1 tab from stripping new optional coverage while draining.
const QUEUE_KEY = "marginalia-reading-checkpoints-v2";
let fallback: ReadingCheckpoint[] = [];
let tail: Promise<void> = Promise.resolve();
let priorityPending = 0;

function readQueue() {
  try {
    const legacy = parseCheckpoints(
      localStorage.getItem("marginalia-reading-checkpoints-v1"),
    );
    return [
      ...legacy,
      ...parseCheckpoints(localStorage.getItem(QUEUE_KEY)),
    ].reduce(mergeCheckpoint, fallback);
  } catch {
    return fallback;
  }
}
function writeQueue(queue: ReadingCheckpoint[]) {
  fallback = queue;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* Live in-memory delivery still works. */
  }
}
export function queueCheckpoints(snapshots: ReadingCheckpoint[]) {
  writeQueue(snapshots.reduce(mergeCheckpoint, readQueue()));
}

/** One foreground sender across startup, online, periodic, cleanup and Done.
 * Done sends its own cumulative snapshots first, never a backlog of other visits.
 * Queue changes are persisted once per batch; acknowledgements re-read newer state.
 */
export function drainCheckpoints(
  send: (entry: ReadingCheckpoint) => Promise<void>,
  priority?: ReadingCheckpoint[],
) {
  if (priority) priorityPending++;
  const run = tail
    .catch(() => {})
    .then(async () => {
      if (globalThis.navigator?.onLine === false)
        throw new Error(
          "Reading activity is saved on this device. Reconnect to finish.",
        );
      const batch = priority ?? readQueue();
      const acknowledged: ReadingCheckpoint[] = [];
      try {
        for (const entry of batch) {
          if (!priority && priorityPending) break;
          await send(entry);
          acknowledged.push(entry);
        }
      } finally {
        if (acknowledged.length) {
          writeQueue(acknowledged.reduce(acknowledgeCheckpoint, readQueue()));
          try {
            const legacy = localStorage.getItem(
              "marginalia-reading-checkpoints-v1",
            );
            if (legacy)
              localStorage.setItem(
                "marginalia-reading-checkpoints-v1",
                JSON.stringify(
                  acknowledged.reduce(
                    acknowledgeCheckpoint,
                    parseCheckpoints(legacy),
                  ),
                ),
              );
          } catch {
            /* The V2 in-memory queue still retains unsent work. */
          }
        }
      }
    });
  const settled = run.finally(() => {
    if (priority) priorityPending--;
  });
  tail = settled;
  return settled;
}
