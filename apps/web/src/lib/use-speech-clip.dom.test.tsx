// @vitest-environment happy-dom
import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClipSource } from "./use-natural-voice";
import {
  requestSpeechClip,
  speechClipSource,
  useSpeechClip,
} from "./use-speech-clip";

const token = vi.hoisted(() => ({ value: "jwt-1" as string | null }));
vi.mock("./convex-token", () => ({
  getConvexToken: async () => token.value,
  tokenSessionGeneration: () => 1,
}));

const URL = "https://happy-animal-123.convex.cloud";
const articleId = "article-1" as never;
const signal = new AbortController().signal;
const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);

/** A Convex HTTP action response: success with the MP3 bytes as $bytes. */
function actionOk(bytes: Uint8Array) {
  return Response.json({
    status: "success",
    value: { $bytes: Buffer.from(bytes).toString("base64") },
    logLines: [],
  });
}

beforeEach(() => {
  token.value = "jwt-1";
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("turns the action's bytes into an audio/mpeg Blob with the same bytes", async () => {
  const clip = vi.fn().mockResolvedValue(audio.buffer);
  const blob = await speechClipSource(clip, articleId)("Hello there.", signal);
  expect(blob.type).toBe("audio/mpeg");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(audio);
  // The article is the one the reader is on, and no voice is sent: the server picks the default
  expect(clip).toHaveBeenCalledWith({ articleId, text: "Hello there." });
});

it("sends the chosen voice with every clip", async () => {
  const clip = vi.fn().mockResolvedValue(audio.buffer);
  const voice = "openrouter:hexgrad/kokoro-82m#bf_emma";
  await speechClipSource(clip, articleId, voice)("Hello there.", signal);
  expect(clip).toHaveBeenCalledWith({ articleId, text: "Hello there.", voice });
});

it("lets the action's ConvexError through untouched, so its sentence reaches the bar", async () => {
  const error = new ConvexError("Your OpenRouter credit has run out.");
  const source = speechClipSource(vi.fn().mockRejectedValue(error), articleId);
  await expect(source("Hello.", signal)).rejects.toBe(error);
});

it("sends the action over HTTP with the token, and returns the MP3 as an audio/mpeg Blob", async () => {
  const fetchMock = vi.fn(async () => actionOk(audio));
  vi.stubGlobal("fetch", fetchMock);

  const blob = await speechClipSource(requestSpeechClip, articleId)(
    "Hello there.",
    signal,
  );
  expect(blob.type).toBe("audio/mpeg");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(audio);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe(`${URL}/api/action`);
  expect((init.headers as Record<string, string>).Authorization).toBe(
    "Bearer jwt-1",
  );
  expect(JSON.parse(init.body as string)).toEqual({
    path: "speech:clip",
    format: "convex_encoded_json",
    args: [{ articleId, text: "Hello there." }],
  });
});

it("passes a ConvexError from the action through with its string data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          status: "error",
          errorMessage: "Your OpenRouter credit has run out.",
          errorData: "Your OpenRouter credit has run out.",
          logLines: [],
        },
        { status: 560 },
      ),
    ),
  );

  const error = await requestSpeechClip({ articleId, text: "Hello." }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<string>).data).toBe(
    "Your OpenRouter credit has run out.",
  );
});

it("says the sign-in sentence without calling the action when there is no token", async () => {
  token.value = null;
  const fetchMock = vi.fn(async () => actionOk(audio));
  vi.stubGlobal("fetch", fetchMock);

  const error = await requestSpeechClip({ articleId, text: "Hello." }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<string>).data).toBe(
    "Sign in to your private reader.",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("gives the same clip source back while the article and voice stay the same", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: ClipSource[] = [];
  function Probe({ id, voice }: { id: string; voice?: string }) {
    seen.push(useSpeechClip(id as never, voice));
    return null;
  }
  const mount = document.createElement("div");
  const root = createRoot(mount);
  await act(async () => root.render(<Probe id="a" />));
  await act(async () => root.render(<Probe id="a" />));
  await act(async () => root.render(<Probe id="b" />));
  await act(async () => root.render(<Probe id="b" voice="v2" />));
  expect(seen[1]).toBe(seen[0]);
  expect(seen[2]).not.toBe(seen[0]);
  expect(seen[3]).not.toBe(seen[2]);
  await act(async () => root.unmount());
});

// Fake websocket that opens and accepts every message without replying, so a
// request the client sends stays pending, as a slow action does.
class OpenSocket {
  static instances: OpenSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(_url: string) {
    OpenSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

/** Whether the React client would make the beforeunload prompt show. */
function hasUnsavedRequests(client: ConvexReactClient): boolean {
  return (
    client as unknown as {
      sync: { requestManager: { hasIncompleteRequests(): boolean } };
    }
  ).sync.requestManager.hasIncompleteRequests();
}

async function openedClient(): Promise<ConvexReactClient> {
  const client = new ConvexReactClient(URL);
  // Let the fake socket open, so a request the client sends is actually Requested
  await new Promise((r) => setTimeout(r, 10));
  return client;
}

it("the check trips while a mutation is pending, so the control below is live", async () => {
  vi.stubGlobal("WebSocket", OpenSocket);
  const client = await openedClient();
  try {
    const mutation = makeFunctionReference<"mutation">("notes:save");
    void client.mutation(mutation, {}).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(hasUnsavedRequests(client)).toBe(true);
  } finally {
    client.close();
  }
});

it("a speech request in flight does not make the React client's unsaved-work check true", async () => {
  vi.stubGlobal("WebSocket", OpenSocket);
  // The fetch never settles, as a slow clip does
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const client = await openedClient();
  try {
    void requestSpeechClip({ articleId, text: "Hello." }).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(hasUnsavedRequests(client)).toBe(false);
  } finally {
    client.close();
  }
});
