import { APICallError, NoObjectGeneratedError, RetryError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObject = vi.fn();
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: (...args: unknown[]) => generateObject(...args),
}));

const { generateObjectWithFallback } = await import("./aiModels");

const unparseable = () =>
  new NoObjectGeneratedError({
    message: "No object generated: could not parse the response.",
    text: '{"thesis": "cleanly properly cleanly properly',
    response: { id: "r", timestamp: new Date(), modelId: "m" },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    } as never,
    finishReason: "length",
  });

/** What the AI SDK throws when a 200 response's body fails to read or parse. */
const unusableBody = (message: string) =>
  new APICallError({
    message,
    cause: new TypeError("terminated"),
    statusCode: 200,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
  });

const target = (id: string) =>
  ({ id, provider: "openrouter", model: id, apiKey: "k" }) as never;

describe("generateObjectWithFallback", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    generateObject.mockReset();
  });
  it("reports numeric usage and resolved model without retaining provider bodies", async () => {
    const observe = vi.fn();
    generateObject.mockResolvedValueOnce({
      object: { ok: true },
      response: { modelId: "resolved-model", headers: { secret: "private" } },
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        inputTokenDetails: { cacheReadTokens: 4 },
        outputTokens: 9,
        outputTokenDetails: { textTokens: 6, reasoningTokens: 3 },
        totalTokens: 21,
        raw: { private: "not telemetry" },
      },
    });
    await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [target("requested")],
      onGeneration: observe,
    });
    expect(observe).toHaveBeenCalledExactlyOnceWith({
      modelId: "requested",
      responseModel: "resolved-model",
      durationMs: expect.any(Number),
      finishReason: "stop",
      parsed: true,
      tokens: {
        input: 12,
        cachedInput: 4,
        output: 9,
        visibleOutput: 6,
        reasoning: 3,
        total: 21,
      },
    });
  });
  it("accounts for an unparseable billed attempt before its retry", async () => {
    const observe = vi.fn();
    generateObject
      .mockRejectedValueOnce(unparseable())
      .mockResolvedValueOnce({ object: { ok: true } });
    await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [target("only")],
      onGeneration: observe,
    });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls[0][0]).toMatchObject({
      parsed: false,
      finishReason: "length",
      tokens: { input: 1, output: 1, total: 2 },
    });
    expect(observe.mock.calls[1][0]).toMatchObject({
      parsed: true,
      tokens: { input: null, output: null, total: null },
    });
  });
  it("does not repeat a billed request when its telemetry observer throws", async () => {
    generateObject.mockResolvedValueOnce({ object: { ok: true } });
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        targets: [target("only")],
        onGeneration: () => {
          throw new Error("observer failed");
        },
      }),
    ).resolves.toMatchObject({ object: { ok: true } });
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
  it("normalizes SDK retry wrappers and uses explicit zero hidden retries", async () => {
    generateObject
      .mockRejectedValueOnce(
        new RetryError({
          message: "Retries exhausted",
          reason: "maxRetriesExceeded",
          errors: [
            new APICallError({
              message: "Unavailable",
              statusCode: 503,
              url: "https://fixture.invalid",
              requestBodyValues: {},
            }),
          ],
        }),
      )
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [target("first"), target("second")],
    });
    expect(result.modelId).toBe("second");
    expect(
      generateObject.mock.calls.every(
        ([options]) =>
          options.maxRetries === 0 &&
          options.abortSignal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
  it("aborts a structured attempt on deadline before trying the next model", async () => {
    vi.useFakeTimers();
    let firstSignal!: AbortSignal;
    generateObject
      .mockImplementationOnce(({ abortSignal }) => {
        firstSignal = abortSignal;
        return new Promise(() => {});
      })
      .mockImplementationOnce(() => {
        expect(firstSignal.aborted).toBe(true);
        return { object: { ok: true } };
      });
    const pending = generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [target("first"), target("second")],
      deadlineMs: 5,
    });
    await vi.advanceTimersByTimeAsync(6);
    expect((await pending).modelId).toBe("second");
  });

  it("asks the same model again when its answer doesn't parse", async () => {
    generateObject
      .mockRejectedValueOnce(unparseable())
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first")],
    });
    expect(result).toEqual({ object: { ok: true }, modelId: "first" });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("moves to the next model after two unparseable answers", async () => {
    generateObject
      .mockRejectedValueOnce(unparseable())
      .mockRejectedValueOnce(unparseable())
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first"), target("second")],
    });
    expect(result.modelId).toBe("second");
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("gives up on the last model after two unparseable answers", async () => {
    generateObject.mockRejectedValue(unparseable());
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        prompt: "p",
        targets: [target("only")],
      }),
    ).rejects.toThrow(/could not parse/);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a call that failed for another reason", async () => {
    generateObject.mockRejectedValue(new Error("bad request"));
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        prompt: "p",
        targets: [target("only")],
      }),
    ).rejects.toThrow("bad request");
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it.each([
    "Failed to process successful response",
    "Invalid JSON response",
  ])("asks the same model again after a %s", async (message) => {
    generateObject
      .mockRejectedValueOnce(unusableBody(message))
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first"), target("second")],
    });
    expect(result).toEqual({ object: { ok: true }, modelId: "first" });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("moves to the next model after two unusable bodies", async () => {
    generateObject
      .mockRejectedValueOnce(
        unusableBody("Failed to process successful response"),
      )
      .mockRejectedValueOnce(
        unusableBody("Failed to process successful response"),
      )
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first"), target("second")],
    });
    expect(result.modelId).toBe("second");
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("does not repeat a request the provider refused with a 4xx", async () => {
    generateObject.mockRejectedValue(
      new APICallError({
        message: "Invalid request",
        statusCode: 400,
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        isRetryable: false,
      }),
    );
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        prompt: "p",
        targets: [target("first"), target("second")],
      }),
    ).rejects.toThrow("Invalid request");
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});

describe("opt-in OpenRouter privacy policy", () => {
  beforeEach(() => generateObject.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { provider: "openrouter", denyDataCollection: true, expected: "deny" },
    { provider: "openrouter", denyDataCollection: false, expected: undefined },
    { provider: "openai", denyDataCollection: true, expected: undefined },
  ] as const)("sends the policy only for opted-in OpenRouter calls: %j", async ({
    provider,
    denyDataCollection,
    expected,
  }) => {
    const requests: Request[] = [];
    const payloads: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        payloads.push(await request.clone().json());
        return new Response(
          JSON.stringify({
            id: "fixture",
            object: "chat.completion",
            created: 0,
            model: "fixture-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: '{"ok":true}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    // Exercise the real SDK model's HTTP path, not a mock of createOpenAI.
    // Only the outer structured-generation helper is mocked in this suite.
    generateObject.mockImplementationOnce(async ({ model, abortSignal }) => {
      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Private fixture passage." }],
          },
        ],
        abortSignal,
        maxOutputTokens: 1400,
      });
      return { object: { ok: true } };
    });
    const controller = new AbortController();
    await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [
        {
          id: `${provider}:fixture-model`,
          provider,
          model: "fixture-model",
          name: "Fixture",
          apiKey: "reader-fixture-key",
        },
      ],
      denyDataCollection,
      signal: controller.signal,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions",
    );
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.get("authorization")).toBe(
      "Bearer reader-fixture-key",
    );
    expect(payloads[0]).toMatchObject({
      model: "fixture-model",
      messages: [{ role: "user", content: "Private fixture passage." }],
    });
    expect(payloads[0].provider).toEqual(
      expected ? { data_collection: expected } : undefined,
    );
    expect(requests[0].signal.aborted).toBe(true);
  });
});
