"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { useMemo } from "react";
import { getConvexToken } from "./convex-token";
import { createTextPreparer, type TextPreparer } from "./narration-preparation";
import { type ClipSource, rememberClipSpeech } from "./use-natural-voice";

type SpeechClipArgs = {
  articleId: Id<"articles">;
  text: string;
  /** A catalog voice id; without one the action reads in the default voice. */
  voice?: string;
};
type SpeechClip = (args: SpeechClipArgs) => Promise<ArrayBuffer>;

// The sentence the action's own auth check gives a signed-out caller
const SIGN_IN = "Sign in to your private reader.";

/**
 * Calls the speech action over HTTP, not the websocket client: the client's
 * beforeunload prompt fires while any request it sent is pending, so a clip in
 * flight would make reloading ask about unsaved changes.
 */
export async function requestSpeechClip(
  args: SpeechClipArgs,
): Promise<ArrayBuffer> {
  const token = await getConvexToken();
  if (!token) throw new ConvexError(SIGN_IN);
  const client = new ConvexHttpClient(
    process.env.NEXT_PUBLIC_CONVEX_URL as string,
    { auth: token },
  );
  return client.action(api.speech.clip, args);
}

/**
 * Turns the speech action into the player's clip source: the action returns
 * the MP3 as bytes, which become a Blob the audio element can play. Errors pass
 * through as the action's own ConvexError, for `failureSentence` to read.
 */
export function speechClipSource(
  clip: SpeechClip,
  articleId: Id<"articles">,
  voice?: string,
  prepare?: TextPreparer,
): ClipSource {
  // Convex actions can't be cancelled, so the signal is left to the player,
  // which ignores a result that arrives after Stop
  return async (text, signal, context) => {
    signal.throwIfAborted();
    const spoken = prepare
      ? await prepare(
          text,
          signal,
          context?.kind ?? (context?.heading ? "heading" : "prose"),
        )
      : text;
    signal.throwIfAborted();
    return rememberClipSpeech(
      new Blob(
        [await clip({ articleId, text: spoken, ...(voice ? { voice } : {}) })],
        {
          type: "audio/mpeg",
        },
      ),
      spoken,
    );
  };
}

/**
 * The clip source for an article in the reader's voice; a book's parts use the
 * book's own id. A new voice makes a new source, which the player answers by
 * fetching what's ahead again (05-player, Fetching ahead).
 */
export function useSpeechClip(
  articleId: Id<"articles">,
  voice: string | undefined,
): ClipSource {
  const prepare = useMemo(() => createTextPreparer(articleId), [articleId]);
  return useMemo(
    () => speechClipSource(requestSpeechClip, articleId, voice, prepare),
    [articleId, voice, prepare],
  );
}
