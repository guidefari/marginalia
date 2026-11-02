// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ListeningSettings,
  type VoiceSampleSource,
} from "./listening-settings";

vi.mock("@/lib/narration-preparation", () => ({
  createTextPreparer: () => async (text: string) => text,
}));

const HEART = "openrouter:hexgrad/kokoro-82m#af_heart";
const EMMA = "openrouter:hexgrad/kokoro-82m#bf_emma";

const state = vi.hoisted(() => ({
  providers: ["openrouter"] as string[],
  setVoice: vi.fn(),
  clip: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(query) === "userSettings:getSpeechVoice"
        ? {
            selected: HEART,
            voices: [
              {
                id: HEART,
                name: "Kokoro · Heart",
                character: "American woman",
              },
              { id: EMMA, name: "Kokoro · Emma", character: "British woman" },
            ],
          }
        : { providers: state.providers },
    useMutation: () =>
      Object.assign(state.setVoice, {
        withOptimisticUpdate: () => state.setVoice,
      }),
  };
});
vi.mock("@/lib/use-speech-clip", () => ({
  requestSpeechClip: (args: unknown) => state.clip(args),
}));

class FakeAudio {
  static all: FakeAudio[] = [];
  src = "";
  onended: (() => void) | null = null;
  constructor() {
    FakeAudio.all.push(this);
  }
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}

let root: Root;
let listen: VoiceSampleSource;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.all = [];
  state.providers = ["openrouter"];
  state.setVoice.mockReset().mockResolvedValue(null);
  state.clip.mockReset().mockResolvedValue(new Uint8Array([1, 2]).buffer);
  URL.createObjectURL = () => "blob:sample";
  URL.revokeObjectURL = () => undefined;
  listen = {
    articleId: "a1" as never,
    text: () => "The paragraph being read.",
    listenPlaying: true,
    listenPaused: false,
    toggleListenPause: vi.fn(() => {
      listen.listenPlaying = !listen.listenPlaying;
      listen.listenPaused = !listen.listenPaused;
    }),
  };
  document.body.innerHTML = '<div id="mount"></div>';
  root = createRoot(document.getElementById("mount") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () =>
    root.render(<ListeningSettings sample={listen} onAddKey={() => {}} />),
  );
const radio = (id: string) =>
  document.querySelector(`input[value="${id}"]`) as HTMLInputElement;
const playButton = (name: string) =>
  document.querySelector(
    `[aria-label="Play a sample of ${name}"]`,
  ) as HTMLButtonElement;

it("lists the voices as a radio group with the saved one chosen", async () => {
  await render();
  expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(radio(HEART).checked).toBe(true);
  expect(radio(EMMA).checked).toBe(false);
});

it("saves a new choice", async () => {
  await render();
  await act(async () => radio(EMMA).click());
  expect(state.setVoice).toHaveBeenCalledWith({ voice: EMMA });
});

it("plays a sample of the paragraph in that voice, pausing Listen until the voices close", async () => {
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  expect(state.clip).toHaveBeenCalledWith({
    articleId: "a1",
    text: "The paragraph being read.",
    voice: EMMA,
  });
  expect(listen.toggleListenPause).toHaveBeenCalledTimes(1);
  expect(FakeAudio.all[0].src).toBe("blob:sample");
  expect(
    document.querySelector('[aria-label="Stop the Kokoro · Emma sample"]'),
  ).not.toBeNull();
  await act(async () => root.unmount());
  expect(listen.toggleListenPause).toHaveBeenCalledTimes(2);
  root = createRoot(document.getElementById("mount") as HTMLElement);
});

it("plays the focused voice's sample on Space instead of re-checking it", async () => {
  await render();
  const event = new KeyboardEvent("keydown", {
    key: " ",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => radio(HEART).dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(state.clip).toHaveBeenCalledWith(
    expect.objectContaining({ voice: HEART }),
  );
});

it("isn't cut off by the priming clip ending before the sample arrives", async () => {
  let answer: (bytes: ArrayBuffer) => void = () => {};
  state.clip.mockReturnValueOnce(
    new Promise<ArrayBuffer>((resolve) => {
      answer = resolve;
    }),
  );
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  await act(async () => FakeAudio.all[0].onended?.());
  await act(async () => answer(new Uint8Array([1]).buffer));
  expect(FakeAudio.all[0].src).toBe("blob:sample");
  expect(
    document.querySelector('[aria-label="Stop the Kokoro · Emma sample"]'),
  ).not.toBeNull();
});

it("sends one request for the first and the last voice when voices are tried quickly", async () => {
  let answer: (bytes: ArrayBuffer) => void = () => {};
  state.clip.mockReturnValueOnce(
    new Promise<ArrayBuffer>((resolve) => {
      answer = resolve;
    }),
  );
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  await act(async () => playButton("Kokoro · Heart").click());
  await act(async () => playButton("Kokoro · Emma").click());
  expect(state.clip).toHaveBeenCalledTimes(1);
  await act(async () => answer(new Uint8Array([1]).buffer));
  expect(state.clip).toHaveBeenCalledTimes(2);
  expect(state.clip).toHaveBeenLastCalledWith(
    expect.objectContaining({ voice: EMMA }),
  );
});

it("keeps one sample request at a time across closing and reopening settings", async () => {
  let answer: (bytes: ArrayBuffer) => void = () => {};
  state.clip.mockReturnValueOnce(
    new Promise<ArrayBuffer>((resolve) => {
      answer = resolve;
    }),
  );
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("mount") as HTMLElement);
  await render();
  await act(async () => playButton("Kokoro · Heart").click());
  expect(state.clip).toHaveBeenCalledTimes(1);
  await act(async () => answer(new Uint8Array([1]).buffer));
  expect(state.clip).toHaveBeenCalledTimes(2);
  expect(state.clip).toHaveBeenLastCalledWith(
    expect.objectContaining({ voice: HEART }),
  );
});

it("stops the sample when Listen resumes from elsewhere, and doesn't pause it again on close", async () => {
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  expect(listen.toggleListenPause).toHaveBeenCalledTimes(1);
  // Headphones resume Listen while the sample plays
  listen = { ...listen, listenPlaying: true, listenPaused: false };
  await render();
  expect(
    document.querySelector('[aria-label="Play a sample of Kokoro · Emma"]'),
  ).not.toBeNull();
  expect(FakeAudio.all[0].pause).toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(listen.toggleListenPause).toHaveBeenCalledTimes(1);
  root = createRoot(document.getElementById("mount") as HTMLElement);
});

it("shows the action's sentence when a sample fails, with Retry", async () => {
  state.clip.mockRejectedValueOnce(
    new ConvexError("Your OpenRouter credit has run out."),
  );
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Your OpenRouter credit has run out.",
  );
});

it("disables the voices and points to Your account without an OpenRouter key", async () => {
  state.providers = [];
  await render();
  expect(radio(HEART).disabled).toBe(true);
  expect(document.body.textContent).toContain(
    "Add an OpenRouter key in Your account",
  );
});

it("sets the listening speed with a slider from 0.8 to 2 in 0.05 steps, and says it", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <ListeningSettings
        sample={listen}
        speed={{ value: 1.2, onChange }}
        onAddKey={() => {}}
      />,
    ),
  );
  const slider = document.getElementById("listening-speed") as HTMLInputElement;
  expect([slider.min, slider.max, slider.step]).toEqual(["0.8", "2", "0.05"]);
  expect(slider.value).toBe("1.2");
  expect(slider.getAttribute("aria-valuetext")).toBe("1.2×");
  expect(document.querySelector("output")?.textContent).toBe("1.2×");
  expect(slider.disabled).toBe(false);
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    set?.call(slider, "1.55");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith(1.55);
});

it("keeps the speed slider usable without a key, since the device voice has a speed too", async () => {
  state.providers = [];
  await act(async () =>
    root.render(
      <ListeningSettings
        sample={listen}
        speed={{ value: 1, onChange: () => {} }}
        onAddKey={() => {}}
      />,
    ),
  );
  expect(
    (document.getElementById("listening-speed") as HTMLInputElement).disabled,
  ).toBe(false);
});
