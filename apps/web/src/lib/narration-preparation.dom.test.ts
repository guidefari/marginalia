// @vitest-environment happy-dom

import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConvexToken } from "./convex-token";
import {
  createTextPreparer,
  requestNarrationPreparation,
} from "./narration-preparation";
import { speechClipSource } from "./use-speech-clip";

const session = vi.hoisted(() => ({
  token: "reader-one" as string | null,
  generation: 1,
}));
vi.mock("./convex-token", () => ({
  getConvexToken: vi.fn(async () => session.token),
  tokenSessionGeneration: () => session.generation,
}));
const articleId = "a1" as never;
const signal = () => new AbortController().signal;
beforeEach(() => {
  session.token = "reader-one";
  session.generation = 1;
  vi.mocked(getConvexToken)
    .mockReset()
    .mockImplementation(async () => session.token);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("narration preparation before synthesis", () => {
  it("retries one discarded token fetch without misreporting a same-session refresh as sign-out", async () => {
    vi.mocked(getConvexToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("fresh-jwt");
    const request = vi.fn(async () => ({ text: "Prepared.", version: "v1" }));
    await expect(
      createTextPreparer(articleId, request)("Source.", signal()),
    ).resolves.toBe("Prepared.");
    expect(getConvexToken).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(expect.any(Object), "fresh-jwt");
  });
  it("sends only prepared words to TTS, retaining the source block kind", async () => {
    const request = vi.fn(async () => ({
      text: "Here's the short version.",
      version: "v1",
    }));
    const prepare = createTextPreparer(articleId, request);
    const clip = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    await speechClipSource(
      clip,
      articleId,
      "voice",
      prepare,
    )("TL;DR.", signal(), { kind: "heading", heading: true });
    expect(request).toHaveBeenCalledWith(
      { articleId, text: "TL;DR.", kind: "heading", lang: "en" },
      "reader-one",
    );
    expect(clip).toHaveBeenCalledWith({
      articleId,
      text: "Here's the short version.",
      voice: "voice",
    });
  });

  it("coalesces identical preparation, but isolates kind, session and article", async () => {
    const request = vi.fn(async () => ({ text: "Prepared.", version: "v1" }));
    const prepare = createTextPreparer(articleId, request);
    await Promise.all([prepare("Same.", signal()), prepare("Same.", signal())]);
    expect(request).toHaveBeenCalledTimes(1);
    await prepare("Same.", signal(), "code");
    session.token = "reader-two";
    session.generation++;
    await prepare("Same.", signal());
    await createTextPreparer("a2" as never, request)("Same.", signal());
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("does not dispatch synthesis after Stop while preparation is in flight", async () => {
    let finish!: (result: { text: string; version: string }) => void;
    const request = vi.fn(
      () =>
        new Promise<{ text: string; version: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const clip = vi.fn();
    const abort = new AbortController();
    const pending = speechClipSource(
      clip,
      articleId,
      undefined,
      createTextPreparer(articleId, request),
    )("Source.", abort.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    abort.abort();
    finish({ text: "Prepared.", version: "v1" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(clip).not.toHaveBeenCalled();
  });

  it("does not reuse prepared content when the authenticated session changes mid-request", async () => {
    const request = vi.fn(async () => {
      session.token = "reader-two";
      session.generation++;
      return { text: "Prepared.", version: "v1" };
    });
    await expect(
      createTextPreparer(articleId, request)("Source.", signal()),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not bypass a preparation failure and lets explicit Retry try again", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ConvexError("Preparation stopped."))
      .mockResolvedValue({ text: "Prepared.", version: "v1" });
    const prepare = createTextPreparer(articleId, request);
    const clip = vi.fn(async () => new ArrayBuffer(1));
    const source = speechClipSource(clip, articleId, undefined, prepare);
    await expect(source("Source.", signal())).rejects.toThrow(
      "Preparation stopped.",
    );
    expect(clip).not.toHaveBeenCalled();
    await source("Source.", signal());
    expect(request).toHaveBeenCalledTimes(2);
    expect(clip).toHaveBeenCalledOnce();
  });

  it("keeps preparation and reuse across token refresh in the same session", async () => {
    const request = vi.fn(async () => {
      session.token = "refreshed-jwt-for-reader-one";
      return { text: "Prepared.", version: "v1" };
    });
    const prepare = createTextPreparer(articleId, request);
    await expect(prepare("Source.", signal())).resolves.toBe("Prepared.");
    await expect(prepare("Source.", signal())).resolves.toBe("Prepared.");
    expect(request).toHaveBeenCalledOnce();
  });

  it("bounds the in-memory cache and refuses empty or oversized prepared text", async () => {
    const request = vi.fn(async () => ({ text: "Prepared.", version: "v1" }));
    const prepare = createTextPreparer(articleId, request);
    for (let i = 0; i < 65; i++) await prepare(`Passage ${i}.`, signal());
    await prepare("Passage 0.", signal());
    expect(request).toHaveBeenCalledTimes(66);
    const bad = createTextPreparer(articleId, async () => ({
      text: "x".repeat(2001),
      version: "v1",
    }));
    await expect(bad("Source.", signal())).rejects.toThrow(
      "couldn't be prepared",
    );
    const empty = createTextPreparer(articleId, async () => ({
      text: "   ",
      version: "v1",
    }));
    await expect(empty("Source.", signal())).rejects.toThrow(
      "couldn't be prepared",
    );
  });

  it("does not call any provider when signed out", async () => {
    session.token = null;
    const request = vi.fn();
    await expect(
      createTextPreparer(articleId, request)("Source.", signal()),
    ).rejects.toThrow("Sign in");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses authenticated HTTP for preparation, without the React mutation transport", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    const fetch = vi.fn(async () =>
      Response.json({
        status: "success",
        value: { text: "Prepared.", version: "v1" },
        logLines: [],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await requestNarrationPreparation(
      { articleId, text: "Source.", kind: "prose", lang: "en" },
      "private-token",
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://test.convex.cloud/api/action");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer private-token",
    );
    expect(JSON.parse(init.body as string).path).toBe("narration:prepare");
  });
});
