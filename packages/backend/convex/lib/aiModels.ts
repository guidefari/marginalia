"use node";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  APICallError,
  generateObject,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  RetryError,
  type Schema,
} from "ai";
import { ConvexError } from "convex/values";
import { toJSONSchema, type ZodType } from "zod";
import {
  ChatGPTRequestError,
  completeResponses,
  isTerminalChatGPTError,
} from "./chatgptResponses";
import { PROVIDER_NAMES, type Provider } from "./providers";
import { resolveTarget } from "./providerTarget";
import { interruptible, requestAttempt } from "./requestControl";
import type { ProviderTarget } from "./router";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface GenerationTelemetry {
  modelId: string;
  responseModel: string | null;
  durationMs: number;
  finishReason: string;
  parsed: boolean;
  tokens: {
    input: number | null;
    cachedInput: number | null;
    output: number | null;
    visibleOutput: number | null;
    reasoning: number | null;
    total: number | null;
  };
}

function reportGeneration(
  observer: ((event: GenerationTelemetry) => void) | undefined,
  event: Omit<GenerationTelemetry, "tokens">,
  usage?: LanguageModelUsage,
) {
  if (!observer) return;
  try {
    observer({
      ...event,
      tokens: {
        input: usage?.inputTokens ?? null,
        cachedInput: usage?.inputTokenDetails?.cacheReadTokens ?? null,
        output: usage?.outputTokens ?? null,
        visibleOutput: usage?.outputTokenDetails?.textTokens ?? null,
        reasoning: usage?.outputTokenDetails?.reasoningTokens ?? null,
        total: usage?.totalTokens ?? null,
      },
    });
  } catch {
    // Observability must not turn a completed, billed request into another attempt.
    console.warn("Generation telemetry observer failed");
  }
}

/** AI SDK RetryError exposes the actual final provider error as lastError. */
export function underlyingAIError(error: unknown): unknown {
  const seen = new Set<RetryError>();
  while (RetryError.isInstance(error) && !seen.has(error)) {
    seen.add(error);
    const last = error.lastError;
    if (last === undefined || last === error) break;
    error = last;
  }
  return error;
}

/** Opt-in wire policy: OpenAI's SDK otherwise drops OpenRouter's provider field. */
const privateOpenRouterFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.method !== "POST") return fetch(request);
  // Fail closed on an unexpected wire format; never forward prose without the
  // requested privacy policy. Neither body nor parse errors enter our logs.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Couldn't apply the requested provider privacy policy");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Couldn't apply the requested provider privacy policy");
  const payload = body as Record<string, unknown>;
  const provider = payload.provider;
  if (
    provider !== undefined &&
    (!provider || typeof provider !== "object" || Array.isArray(provider))
  )
    throw new Error("Couldn't apply the requested provider privacy policy");
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return fetch(
    new Request(request, {
      headers,
      body: JSON.stringify({
        ...payload,
        provider: { ...provider, data_collection: "deny" },
      }),
    }),
  );
};

/** An AI SDK model that calls the target's provider with the reader's own key. */
function languageModel(
  target: ProviderTarget & { provider: Provider },
  denyDataCollection = false,
) {
  switch (target.provider) {
    case "openrouter":
      return createOpenAI({
        baseURL: OPENROUTER_BASE_URL,
        apiKey: target.apiKey,
        headers: { "X-Title": "Marginalia" },
        ...(denyDataCollection ? { fetch: privateOpenRouterFetch } : {}),
      }).chat(target.model);
    case "openai":
      return createOpenAI({ apiKey: target.apiKey }).chat(target.model);
    case "anthropic":
      return createAnthropic({ apiKey: target.apiKey })(target.model);
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const status = (error as Record<string, unknown>).statusCode;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function isAuthError(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

/**
 * An answer the provider sent with a success status that couldn't be read or
 * parsed. The AI SDK throws an APICallError at that status: "Failed to process
 * successful response" when the body fails mid-read, and "Invalid JSON
 * response" when it isn't JSON. It marks both non-retryable, so the SDK never
 * retries them; a truncated or garbled body is a transient fault, so it's
 * handled like an unparseable answer.
 */
function isUnusableSuccessBody(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  const status = error.statusCode;
  return status !== undefined && status >= 200 && status < 300;
}

function isUnparseableAnswer(error: unknown): boolean {
  return (
    NoObjectGeneratedError.isInstance(error) || isUnusableSuccessBody(error)
  );
}

function isRetryableError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429 || (status && status >= 500 && status < 600)) return true;
  const message =
    error && typeof error === "object"
      ? (error as Record<string, unknown>).message
      : undefined;
  return typeof message === "string" && message.includes("429");
}

export async function generateObjectWithFallback<T>(options: {
  schema: ZodType<T>;
  /** Optional provider wire schema; the full local schema remains authoritative. */
  providerSchema?: Schema<T>;
  /** Resolve wire compatibility separately for each fallback model. */
  providerSchemaForTarget?: (modelId: string) => Schema<T> | undefined;
  prompt?: string;
  system?: string;
  /** The reader's own models, tried in order after a retryable failure. */
  targets: ProviderTarget[];
  /** Bound output reservation for tasks that need only a short response. */
  maxOutputTokens?: number;
  /** Opt in to OpenRouter's deny-data-collection provider routing policy. */
  denyDataCollection?: boolean;
  /** Told about each failure, so a ChatGPT connection can record its state. */
  onFailure?: (error: unknown) => Promise<void>;
  signal?: AbortSignal;
  /** Per-model structured generation deadline, including parse retries. */
  deadlineMs?: number;
  /** Let a task own one shared budget across parsing and domain repairs. */
  maxParseAttempts?: 1 | 2;
  /** Safe numeric metadata only; prompts, credentials and response bodies are excluded. */
  onGeneration?: (event: GenerationTelemetry) => void;
}): Promise<{ object: T; modelId: string }> {
  if (!options.targets.length)
    throw new Error("No AI model is available for this library");
  let lastError: unknown;
  for (const [index, target] of options.targets.entries()) {
    options.signal?.throwIfAborted();
    const attempt = requestAttempt(
      options.signal,
      options.deadlineMs ?? 240_000,
    );
    try {
      const isLast = index === options.targets.length - 1;
      if (target.provider === "chatgpt") {
        try {
          const resolved = await resolveTarget(target);
          attempt.signal.throwIfAborted();
          return {
            object: await interruptible(
              generateWithChatGPT(resolved, {
                ...options,
                signal: attempt.signal,
              }),
              attempt.signal,
            ),
            modelId: target.id,
          };
        } catch (caught) {
          attempt.abort(caught);
          options.signal?.throwIfAborted();
          const error = underlyingAIError(caught);
          lastError = error;
          await options.onFailure?.(error).catch(() => {});
          // The plan's own limits are the reader's to see, not a reason to
          // quietly spend one of their API keys instead
          if (isTerminalChatGPTError(error))
            throw new ConvexError(error.readerMessage);
          if (!isLast) {
            console.error(`${target.id} failed`);
            continue;
          }
          if (error instanceof ChatGPTRequestError)
            throw new ConvexError(error.readerMessage);
          throw error;
        }
      }
      try {
        return {
          object: await interruptible(
            generateParsedObject<T>(
              target.id,
              languageModel(
                { ...target, provider: target.provider },
                options.denyDataCollection,
              ),
              {
                ...options,
                providerSchema:
                  options.providerSchemaForTarget?.(target.id) ??
                  options.providerSchema,
                signal: attempt.signal,
              },
            ),
            attempt.signal,
          ),
          modelId: target.id,
        };
      } catch (caught) {
        attempt.abort(caught);
        options.signal?.throwIfAborted();
        const error = underlyingAIError(caught);
        lastError = error;
        // A refused key may belong to one of the reader's providers; another may still work
        if (isAuthError(error)) {
          if (isLast)
            throw new ConvexError(
              `${PROVIDER_NAMES[target.provider]} didn't accept your saved key. Update it in Your account.`,
            );
          continue;
        }
        if (
          (isRetryableError(error) ||
            isUnparseableAnswer(error) ||
            (error instanceof DOMException && error.name === "TimeoutError")) &&
          !isLast
        )
          continue;
        throw error;
      }
    } finally {
      attempt.abort();
      attempt.dispose();
    }
  }
  throw lastError;
}

/**
 * One model call, asked a second time when its answer doesn't parse. A model
 * now and then falls into repeating words inside a string until it runs out of
 * tokens; that is a sampling accident, so the same model usually answers
 * cleanly when asked again. A success response with a truncated body is the
 * same kind of fault, so it gets the same second ask.
 */
async function generateParsedObject<T>(
  modelId: string,
  model: ReturnType<typeof languageModel>,
  options: {
    schema: ZodType<T>;
    providerSchema?: Schema<T>;
    prompt?: string;
    system?: string;
    maxOutputTokens?: number;
    maxParseAttempts?: 1 | 2;
    onGeneration?: (event: GenerationTelemetry) => void;
    signal: AbortSignal;
  },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    options.signal.throwIfAborted();
    const startedAt = Date.now();
    let observed = false;
    try {
      const result = await generateObject<ZodType<T> | Schema<T>, "object">({
        model,
        output: "object",
        schema: options.providerSchema ?? options.schema,
        prompt: options.prompt ?? "",
        system: options.system,
        maxOutputTokens: options.maxOutputTokens,
        abortSignal: options.signal,
        // The application owns fallback and parse retry; avoid hidden SDK spend.
        maxRetries: 0,
      });
      const parsed = options.schema.safeParse(result.object);
      observed = true;
      reportGeneration(
        options.onGeneration,
        {
          modelId,
          responseModel: result.response?.modelId ?? null,
          durationMs: Date.now() - startedAt,
          finishReason: result.finishReason ?? "unknown",
          parsed: parsed.success,
        },
        result.usage,
      );
      if (!parsed.success) throw parsed.error;
      return parsed.data;
    } catch (caught) {
      const error = underlyingAIError(caught);
      if (!observed) {
        const unparsed = NoObjectGeneratedError.isInstance(error)
          ? error
          : null;
        reportGeneration(
          options.onGeneration,
          {
            modelId,
            responseModel: unparsed?.response?.modelId ?? null,
            durationMs: Date.now() - startedAt,
            finishReason: unparsed?.finishReason ?? "error",
            parsed: false,
          },
          unparsed?.usage,
        );
      }
      options.signal.throwIfAborted();
      if (
        attempt >= (options.maxParseAttempts ?? PARSE_ATTEMPTS) ||
        !isUnparseableAnswer(error)
      )
        throw error;
      console.warn(`${modelId} answered unusably; asking again`);
    }
  }
}

const PARSE_ATTEMPTS = 2;

/**
 * Plan usage streams through the Responses API with no output cap, so the
 * schema travels in the instructions and the answer is checked here.
 */
async function generateWithChatGPT<T>(
  target: ProviderTarget,
  options: {
    schema: ZodType<T>;
    prompt?: string;
    system?: string;
    signal: AbortSignal;
  },
): Promise<T> {
  options.signal.throwIfAborted();
  const content = await completeResponses({
    accessToken: target.apiKey,
    model: target.model,
    messages: [
      ...(options.system
        ? [{ role: "system" as const, content: options.system }]
        : []),
      { role: "user", content: options.prompt ?? "" },
    ],
    jsonSchema: toJSONSchema(options.schema),
    signal: options.signal,
  });
  return options.schema.parse(JSON.parse(content));
}
