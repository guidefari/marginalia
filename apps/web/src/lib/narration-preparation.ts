"use client";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import type { NarrationKind } from "@marginalia/backend/narration";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { getConvexToken, tokenSessionGeneration } from "./convex-token";

export type TextPreparer = (
  text: string,
  signal: AbortSignal,
  kind?: NarrationKind,
) => Promise<string>;
type PrepareArgs = {
  articleId: Id<"articles">;
  text: string;
  kind: NarrationKind;
  lang: string;
};
const prepareReference = makeFunctionReference<
  "action",
  PrepareArgs,
  { text: string; version: string }
>("narration:prepare");

/** HTTP avoids treating a paid request as an unsaved document on page exit. */
export async function requestNarrationPreparation(
  args: PrepareArgs,
  token: string,
) {
  const client = new ConvexHttpClient(
    process.env.NEXT_PUBLIC_CONVEX_URL as string,
    { auth: token },
  );
  return client.action(prepareReference, args);
}

/** Per-article, in-memory only: no prose survives the mounted reader or crosses sessions. */
export function createTextPreparer(
  articleId: Id<"articles">,
  request = requestNarrationPreparation,
): TextPreparer {
  const cache = new Map<string, Promise<string>>();
  return async (text, signal, kind = "prose") => {
    signal.throwIfAborted();
    const generation = tokenSessionGeneration();
    const token = await getConvexToken();
    signal.throwIfAborted();
    if (tokenSessionGeneration() !== generation)
      throw new DOMException("The reader session changed.", "AbortError");
    if (!token) throw new ConvexError("Sign in to your private reader.");
    const lang = document.documentElement.lang || "en";
    const key = JSON.stringify([generation, lang, kind, text]);
    let prepared = cache.get(key);
    if (!prepared) {
      prepared = request({ articleId, text, kind, lang }, token).then(
        (result) => {
          if (!result.text.trim() || result.text.length > 2000)
            throw new ConvexError(
              "This passage couldn't be prepared for listening. Try again.",
            );
          return result.text;
        },
      );
      cache.set(key, prepared);
      // A failed attempt is explicitly retryable, never a cached raw-text fallback.
      void prepared.catch(() => {
        if (cache.get(key) === prepared) cache.delete(key);
      });
      while (cache.size > 64) cache.delete(cache.keys().next().value as string);
    }
    const result = await prepared;
    signal.throwIfAborted();
    if (tokenSessionGeneration() !== generation)
      throw new DOMException("The reader session changed.", "AbortError");
    signal.throwIfAborted();
    return result;
  };
}
