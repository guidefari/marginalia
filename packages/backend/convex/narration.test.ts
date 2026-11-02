/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NARRATION_VERSION, type NarrationKind } from "./lib/narration";
import { READER_LIMITS } from "./limits";

const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./lib/aiModels", () => ({
  generateObjectWithFallback: model.generate,
}));
const modules = import.meta.glob("./**/*.ts");
// No generated API edits needed to test a newly registered public action.
const prepare = makeFunctionReference<
  "action",
  {
    articleId: Id<"articles">;
    text: string;
    kind: NarrationKind;
    lang?: string;
  },
  { text: string; version: string }
>("narration:prepare");
const TEXT = "Dr. Reed will not accept -2.50%.";
const KEY = "reader-only-fixture-key";
const RETRY = "This passage couldn't be prepared for listening. Retry.";

beforeEach(() => {
  model.generate.mockReset();
  model.generate.mockResolvedValue({
    object: { edits: [] },
    modelId: "fixture",
  });
  vi.stubEnv("OPENROUTER_API_KEY", "forbidden-server-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function fixture(key = true) {
  const f = await secondReaderTest(modules);
  if (key) await saveTestCredential(f.t, f.readerLibraryId, "openrouter", KEY);
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: f.readerLibraryId,
      guid: "narration",
      url: "https://example.com/narration",
      title: "Narration",
      extractionStatus: "extracted",
      createdAt: 0,
      annotationStatus: "skipped",
    }),
  );
  const args = { articleId, text: TEXT, kind: "prose" as const };
  return { ...f, articleId, args, call: () => f.reader.action(prepare, args) };
}

describe("narration.prepare", () => {
  it("returns validated spoken text/version with the reader's bounded Quick chain", async () => {
    const f = await fixture();
    model.generate.mockResolvedValueOnce({
      object: {
        edits: [
          {
            original: "Dr.",
            replacement: "Doctor",
          },
        ],
      },
      modelId: "fixture",
    });
    await expect(f.call()).resolves.toEqual({
      text: "Doctor Reed will not accept -2.50%.",
      version: NARRATION_VERSION,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    const options = model.generate.mock.calls[0][0];
    expect(options).toMatchObject({
      deadlineMs: 20_000,
      maxOutputTokens: 1400,
      maxParseAttempts: 1,
      denyDataCollection: true,
    });
    expect(options.targets.length).toBeLessThanOrEqual(2);
    expect(options.targets[0].model).toBe("deepseek/deepseek-v4.1-flash");
    expect(
      options.targets.every(
        (target: { apiKey: string; provider: string }) =>
          target.apiKey === KEY && target.provider !== "chatgpt",
      ),
    ).toBe(true);
    expect(
      await f.t.run((ctx) => ctx.db.query("readerLimits").collect()),
    ).toEqual([
      expect.objectContaining({
        userId: f.readerLibraryId,
        bucket: "speechPreparation",
        count: 1,
      }),
    ]);
  });

  it("requires a signed-in authorized reader before generation", async () => {
    const f = await fixture();
    await expect(f.t.action(prepare, f.args)).rejects.toThrow();
    expect(model.generate).not.toHaveBeenCalled();
    expect(
      await f.t.run((ctx) => ctx.db.query("readerLimits").collect()),
    ).toEqual([]);
  });

  it("uses raw code as evidence and returns a labeled spoken explanation, not bracket reading", async () => {
    const f = await fixture();
    const text = "if (x !== -2) return false;";
    model.generate.mockResolvedValueOnce({
      object: {
        edits: [],
        codeExplanation: "If x is strictly not equal to -2, return false.",
      },
      modelId: "fixture",
    });
    await expect(
      f.reader.action(prepare, { ...f.args, text, kind: "code" }),
    ).resolves.toEqual({
      text: "Code explanation. If x is strictly not equal to -2, return false. End of code explanation.",
      version: NARRATION_VERSION,
    });
    const prompt = JSON.parse(model.generate.mock.calls[0][0].prompt);
    expect(prompt.source).toBe(text);
  });

  it("fails an unavailable code explanation explicitly, without raw text or another dispatch", async () => {
    const f = await fixture();
    model.generate.mockResolvedValueOnce({
      object: { edits: [], codeExplanation: null },
      modelId: "fixture",
    });
    await expect(
      f.reader.action(prepare, {
        ...f.args,
        text: "if (x !== -2) return false;",
        kind: "code",
      }),
    ).rejects.toThrow(RETRY);
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("accepts complete DOM-labeled tables without losing header/cell associations", async () => {
    const f = await fixture();
    const text =
      "Table: Change, in percent.\nColumn headings: Region; 2025.\nRegion: North; 2025: -0.5%.\nRegion: South; 2025: blank.\nEnd of table.";
    await expect(
      f.reader.action(prepare, { ...f.args, text, kind: "table" }),
    ).resolves.toEqual({
      text,
      version: NARRATION_VERSION,
    });
  });

  it.each([
    "Table: Change, in percent.\nColumn headings: Region; 2025.\nRegion: North;",
    "2025: -0.5%.\nRegion: South; 2025: blank.",
    "Region: West; 2025: +3%.\nEnd of table.",
  ])("prepares bounded table continuation chunks without demanding table wrappers: %j", async (text) => {
    const f = await fixture();
    await expect(
      f.reader.action(prepare, { ...f.args, text, kind: "table" }),
    ).resolves.toEqual({
      text,
      version: NARRATION_VERSION,
    });
    expect(JSON.parse(model.generate.mock.calls[0][0].prompt).source).toBe(
      text,
    );
  });

  it("checks ownership before budgets, keys or generation", async () => {
    const f = await fixture();
    const refused = await f.owner
      .action(prepare, f.args)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConvexError);
    expect((refused as ConvexError<string>).data).toBe(
      "This article isn't available for listening. Retry.",
    );
    expect(model.generate).not.toHaveBeenCalled();
    expect(
      await f.t.run((ctx) => ctx.db.query("readerLimits").collect()),
    ).toEqual([]);
  });

  it("retains the established licensed-Bible article boundary, without a new policy", async () => {
    const f = await fixture();
    await f.reader.mutation(api.bible.setPreferences, { enabled: true });
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleId, {
        bible: {
          reference: "John 3:16",
          translation: "niv",
          copyright: "Publisher notice",
        },
      }),
    );
    await expect(f.call()).rejects.toThrow(
      "This article isn't available for listening. Retry.",
    );
    expect(model.generate).not.toHaveBeenCalled();
    expect(
      await f.t.run((ctx) => ctx.db.query("readerLimits").collect()),
    ).toEqual([]);
    // Public-domain WEB remains preparable through the same existing guard.
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleId, {
        bible: {
          reference: "John 3:16",
          translation: "web",
          copyright: "Public domain",
        },
      }),
    );
    await expect(f.call()).resolves.toMatchObject({ text: TEXT });
  });

  it.each([
    "",
    " \n",
    "x".repeat(1001),
    "😀".repeat(501),
  ])("refuses invalid input before spend: %j", async (text) => {
    const f = await fixture();
    await expect(f.reader.action(prepare, { ...f.args, text })).rejects.toThrow(
      RETRY,
    );
    expect(model.generate).not.toHaveBeenCalled();
    expect(
      await f.t.run((ctx) => ctx.db.query("readerLimits").collect()),
    ).toEqual([]);
  });

  it("accepts exactly 1000 UTF-16 source characters", async () => {
    const f = await fixture();
    const text = "a".repeat(1000);
    await expect(
      f.reader.action(prepare, { ...f.args, text }),
    ).resolves.toMatchObject({ text });
  });

  it("never borrows another reader's or the server's key", async () => {
    const f = await fixture(false);
    await saveTestCredential(
      f.t,
      "default_user",
      "openrouter",
      "forbidden-owner-key",
    );
    await expect(f.call()).rejects.toThrow("needs your own AI provider key");
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("does not silently spend a key when Quick explicitly selects an uncapped plan", async () => {
    const f = await fixture();
    const router = await import("./lib/router");
    vi.spyOn(router, "loadReaderAI").mockResolvedValueOnce({
      providers: ["chatgpt", "openrouter"],
      chain: () => [
        {
          id: "chatgpt:fixture",
          model: "fixture",
          name: "Plan",
          provider: "chatgpt",
          apiKey: "",
        },
        {
          id: "openrouter:fixture",
          model: "fixture",
          name: "Key",
          provider: "openrouter",
          apiKey: KEY,
        },
      ],
      embedder: () => null,
      noteFailure: async () => {},
    });
    await expect(f.call()).rejects.toThrow(
      "Choose an API-key model for Quick tasks",
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("removes uncapped fallbacks and truncates even an oversized future chain to two dispatches", async () => {
    const f = await fixture();
    const router = await import("./lib/router");
    const target = {
      id: "openrouter:fixture",
      model: "fixture",
      name: "Key",
      provider: "openrouter" as const,
      apiKey: KEY,
    };
    vi.spyOn(router, "loadReaderAI").mockResolvedValueOnce({
      providers: ["openrouter"],
      chain: () => [target, { ...target, provider: "chatgpt" }, target, target],
      embedder: () => null,
      noteFailure: async () => {},
    });
    await f.call();
    expect(model.generate.mock.calls[0][0].targets).toEqual([target, target]);
  });

  it("refuses an exhausted dedicated bucket without dispatching", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.insert("readerLimits", {
        userId: f.readerLibraryId,
        bucket: "speechPreparation",
        startedAt: Date.now(),
        count: READER_LIMITS.speechPreparation.max,
      }),
    );
    await expect(f.call()).rejects.toThrow(
      READER_LIMITS.speechPreparation.message,
    );
    expect(model.generate).not.toHaveBeenCalled();
  });

  it.each([
    { text: "Unvalidated replacement" },
    {
      edits: [
        {
          original: TEXT,
          replacement: "Safe at +2.50%.",
        },
      ],
    },
    {
      edits: [{ original: "Dr.", replacement: "x".repeat(2001) }],
    },
    { edits: [{ original: "Mr.", replacement: "Mister" }] },
  ])("rejects invalid output without raw fallback or repair retry: %j", async (object) => {
    const f = await fixture();
    model.generate.mockResolvedValueOnce({ object, modelId: "fixture" });
    await expect(f.call()).rejects.toThrow(RETRY);
    expect(model.generate).toHaveBeenCalledTimes(1);
    await expect(f.call()).resolves.toMatchObject({ text: TEXT });
    expect(model.generate).toHaveBeenCalledTimes(2);
  });

  it("returns a safe Retry sentence and does not log raw errors, prose or keys", async () => {
    const f = await fixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    model.generate.mockRejectedValueOnce(
      new ConvexError(`${KEY} ${TEXT} raw provider body`),
    );
    const refused = await f.call().catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(ConvexError);
    expect((refused as ConvexError<string>).data).toBe(RETRY);
    expect(
      JSON.stringify([log.mock.calls, error.mock.calls, warn.mock.calls]),
    ).not.toMatch(/reader-only-fixture-key|Dr\. Reed|raw provider body/);
  });

  it.each([
    "delete",
    "transfer",
  ] as const)("rechecks ownership after generation: %s", async (change) => {
    const f = await fixture();
    model.generate.mockImplementationOnce(async () => {
      await f.t.run((ctx) =>
        change === "delete"
          ? ctx.db.delete(f.articleId)
          : ctx.db.patch(f.articleId, { userId: "default_user" }),
      );
      return { object: { edits: [] }, modelId: "fixture" };
    });
    await expect(f.call()).rejects.toThrow(
      "This article isn't available for listening. Retry.",
    );
  });
});
