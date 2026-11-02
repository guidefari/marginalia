import { abortable } from "./abortable";
import { authClient } from "./auth-client";

/** Refresh this long before expiry so a request never carries a dying token. */
const REFRESH_MARGIN_MS = 60_000;

interface Cached {
  token: string;
  expiresAt: number;
}

let cached: Cached | null = null;
let inflight: Promise<string | null> | null = null;
// The session the cache belongs to, and a generation that changes with it, so
// a token fetched for an earlier session can never land in a later one's cache
let session: string | null = null;
let generation = 0;

/** Stable across JWT refreshes; changes on sign-out or a different reader session. */
export function tokenSessionGeneration(): number {
  return generation;
}

/** Ties the cache to the signed-in session; a different session starts empty. */
export function setTokenSession(sessionId: string | null) {
  if (sessionId === session) return;
  session = sessionId;
  generation++;
  cached = null;
  inflight = null;
}

/** The JWT's `exp` in ms, or null when it can't be read. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Keeps a token the Convex client obtained, so direct calls can reuse it.
 * Ignored unless it was fetched for the session the cache belongs to.
 */
export function rememberConvexToken(sessionId: string, token: string | null) {
  if (sessionId !== session) return;
  const expiresAt = token ? tokenExpiry(token) : null;
  cached = token && expiresAt ? { token, expiresAt } : null;
}

export function forgetConvexToken() {
  cached = null;
  inflight = null;
  generation++;
}

/**
 * A Convex JWT for direct calls to the HTTP endpoint, or null when there is no
 * session. Refreshes through the auth client when none is cached or it is
 * within a minute of expiring.
 */
export function getConvexToken(
  now: () => number = Date.now,
  fetchToken: () => Promise<string | null> = async () => {
    const result = await authClient.convex.token({
      fetchOptions: { throw: false },
    });
    return result.data?.token ?? null;
  },
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  if (!session) return Promise.resolve(null);
  if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS)
    return Promise.resolve(cached.token);
  if (inflight) return signal ? abortable(inflight, signal) : inflight;
  const started = generation;
  const owner = session;
  const pending = fetchToken()
    .then((token) => {
      // The session changed while this was in flight: the token is not theirs
      if (started !== generation) return null;
      rememberConvexToken(owner, token);
      return token;
    })
    .finally(() => {
      if (inflight === pending) inflight = null;
    });
  inflight = pending;
  return signal ? abortable(pending, signal) : pending;
}
