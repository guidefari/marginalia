import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth-client", () => ({ authClient: {} }));

import {
  forgetConvexToken,
  getConvexToken,
  rememberConvexToken,
  setTokenSession,
  tokenExpiry,
  tokenSessionGeneration,
} from "./convex-token";

const jwt = (expSeconds: number) =>
  `h.${btoa(JSON.stringify({ exp: expSeconds })).replace(/=/g, "")}.s`;
const NOW = 1_000_000_000_000;
const now = () => NOW;

beforeEach(() => {
  setTokenSession(null);
  forgetConvexToken();
  setTokenSession("A");
});

describe("tokenExpiry", () => {
  it("reads exp in milliseconds", () => {
    expect(tokenExpiry(jwt(1_000_000_600))).toBe(1_000_000_600_000);
  });
  it("returns null for a malformed token", () => {
    expect(tokenExpiry("nope")).toBeNull();
    expect(tokenExpiry("a.!!.c")).toBeNull();
  });
});

describe("getConvexToken", () => {
  it("changes the reader generation only for session changes, not rejected-token refreshes", () => {
    const generation = tokenSessionGeneration();
    forgetConvexToken();
    expect(tokenSessionGeneration()).toBe(generation);
    setTokenSession("A");
    expect(tokenSessionGeneration()).toBe(generation);
    setTokenSession("B");
    expect(tokenSessionGeneration()).toBe(generation + 1);
    setTokenSession(null);
    expect(tokenSessionGeneration()).toBe(generation + 2);
  });
  it("aborts one waiter without cancelling the shared refresh or losing its cache", async () => {
    const fresh = jwt(NOW / 1000 + 600);
    let finish!: (value: string) => void;
    const fetchToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const stopped = getConvexToken(now, fetchToken, controller.signal);
    const other = getConvexToken(now, fetchToken);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    finish(fresh);
    expect(await other).toBe(fresh);
    expect(await getConvexToken(now, fetchToken)).toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
  it("reuses a cached token that is more than 60s from expiry", async () => {
    const token = jwt(NOW / 1000 + 300);
    rememberConvexToken("A", token);
    const fetchToken = vi.fn();
    expect(await getConvexToken(now, fetchToken)).toBe(token);
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("refreshes a token within 60s of expiry", async () => {
    rememberConvexToken("A", jwt(NOW / 1000 + 30));
    const fresh = jwt(NOW / 1000 + 600);
    const fetchToken = vi.fn().mockResolvedValue(fresh);
    expect(await getConvexToken(now, fetchToken)).toBe(fresh);
    expect(await getConvexToken(now, fetchToken)).toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired token and when none is cached", async () => {
    rememberConvexToken("A", jwt(NOW / 1000 - 10));
    const fetchToken = vi.fn().mockResolvedValue(null);
    expect(await getConvexToken(now, fetchToken)).toBeNull();
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    const fresh = jwt(NOW / 1000 + 600);
    const fetchToken = vi.fn().mockResolvedValue(fresh);
    await Promise.all([
      getConvexToken(now, fetchToken),
      getConvexToken(now, fetchToken),
    ]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("does not cache a token without a readable expiry", async () => {
    rememberConvexToken("A", "opaque");
    const fetchToken = vi.fn().mockResolvedValue(null);
    await getConvexToken(now, fetchToken);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});

describe("one session's token never reaches another", () => {
  it("drops a token that arrives after the session changed", async () => {
    let finish: (token: string) => void = () => {};
    const slow = vi.fn(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    const pending = getConvexToken(now, slow);
    setTokenSession("B");
    finish(jwt(NOW / 1000 + 600));
    expect(await pending).toBeNull();
    const bToken = jwt(NOW / 1000 + 900);
    const fetchB = vi.fn().mockResolvedValue(bToken);
    expect(await getConvexToken(now, fetchB)).toBe(bToken);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("ignores a remembered token for a session that is not current", async () => {
    rememberConvexToken("other", jwt(NOW / 1000 + 600));
    const fetchToken = vi.fn().mockResolvedValue(null);
    await getConvexToken(now, fetchToken);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("gives no token without a session", async () => {
    setTokenSession(null);
    const fetchToken = vi.fn();
    expect(await getConvexToken(now, fetchToken)).toBeNull();
    expect(fetchToken).not.toHaveBeenCalled();
  });
});
