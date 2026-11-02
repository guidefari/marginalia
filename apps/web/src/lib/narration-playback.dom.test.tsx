// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeviceVoice } from "./device-voice";
import type { TextPreparer } from "./narration-preparation";
import { useNaturalVoice } from "./use-natural-voice";

class AudioStub {
  static instances: AudioStub[] = [];
  src = "";
  currentTime = 0;
  get duration(): number {
    throw new Error("Do not use unreliable MP3 duration");
  }
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  listeners = new Map<string, (() => void)[]>();
  constructor() {
    AudioStub.instances.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  fire(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }
}
class Utterance {
  onend: (() => void) | null = null;
  onboundary: ((event: { charIndex: number }) => void) | null = null;
  constructor(public text: string) {}
}
let root: Root;
let article: HTMLElement;
let device: ReturnType<typeof useDeviceVoice>;
let natural: ReturnType<typeof useNaturalVoice>;
let y = 0;
const scroll = vi.fn((options: ScrollToOptions) => {
  y = options.top ?? y;
  window.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("scrollend"));
});
const speak = vi.fn();
let nativePaused = false;
const heard: Utterance[] = [];
const clip = vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" }));
function Device({ prepare }: { prepare?: TextPreparer }) {
  device = useDeviceVoice(
    { current: article },
    "a1",
    "u1",
    "source",
    "",
    1,
    prepare,
  );
  return null;
}
function Natural() {
  natural = useNaturalVoice(
    { current: article },
    "a1",
    "u1",
    "source",
    "",
    clip,
  );
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", AudioStub);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  nativePaused = false;
  heard.length = 0;
  speak.mockImplementation((utterance: Utterance) => {
    if (!nativePaused) heard.push(utterance);
  });
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel: vi.fn(),
    pause: vi.fn(() => {
      nativePaused = true;
    }),
    resume: vi.fn(() => {
      nativePaused = false;
    }),
    get paused() {
      return nativePaused;
    },
    getVoices: () => [],
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  Object.defineProperty(window, "scrollY", {
    get: () => y,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(window, "scrollTo", {
    value: scroll,
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:audio");
  URL.revokeObjectURL = vi.fn();
  document.body.innerHTML =
    '<article><div data-article-body><p data-para="1">One passage with many words is read at a steady pace, and its later lines should remain visible while the narration continues to the end.</p><p data-para="2">The end.</p></div></article><div id="root"></div>';
  article = document.querySelector("article")!;
  const first = article.querySelector<HTMLElement>("p")!;
  first.getBoundingClientRect = () =>
    ({ top: 100 - y, bottom: 1900 - y, height: 1800 }) as DOMRect;
  y = 0;
  AudioStub.instances = [];
  scroll.mockClear();
  speak.mockClear();
  clip.mockClear();
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps the later part of a tall source passage visible as natural speech advances, without MP3 duration", async () => {
  await act(async () => root.render(<Natural />));
  await act(async () => natural.speakFrom(0));
  expect(natural.status).toBe("playing");
  const before = y;
  const audio = AudioStub.instances[0];
  audio.currentTime = 8;
  await act(async () => audio.fire("timeupdate"));
  expect(y).toBeGreaterThan(before);
  expect(natural.following).toBe(true);
  expect(natural.index).toBe(0);
});

it("prepares device speech before speaking, and follows its source with boundary events", async () => {
  const prepare = vi.fn(
    async () => "Prepared words. The complete source is represented here.",
  );
  await act(async () => root.render(<Device prepare={prepare} />));
  await act(async () => device.speakFrom(0));
  expect(prepare).toHaveBeenCalledOnce();
  const utterance = speak.mock.calls[0][0] as Utterance;
  expect(utterance.text).toBe(
    "Prepared words. The complete source is represented here.",
  );
  const before = y;
  await act(async () =>
    utterance.onboundary?.({ charIndex: utterance.text.length - 2 }),
  );
  expect(y).toBeGreaterThan(before);
  expect(device.index).toBe(0);
});

it("holds device speech if Pause was pressed during preparation, then speaks on Resume", async () => {
  let finish!: (text: string) => void;
  const prepare: TextPreparer = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await act(async () => root.render(<Device prepare={prepare} />));
  await act(async () => device.speakFrom(0));
  expect(device.preparing).toBe(true);
  await act(async () => device.togglePause());
  await act(async () => finish("Prepared."));
  expect(speak).not.toHaveBeenCalled();
  await act(async () => device.togglePause());
  expect(speak.mock.calls[0][0].text).toBe("Prepared.");
  expect(heard.map((utterance) => utterance.text)).toEqual(["Prepared."]);
});

it("starts within a table range and skips past it on device Next, rather than replaying the same table", async () => {
  article.innerHTML =
    '<div data-article-body><p data-para="1">Before.</p><table><tr><td><p data-para="2">A</p></td><td><p data-para="3">-2</p></td></tr></table><p data-para="4">After.</p></div>';
  await act(async () => root.render(<Device />));
  await act(async () => device.speakFrom(2));
  expect(speak.mock.calls.at(-1)?.[0].text).toContain("-2");
  expect(article.querySelector("table")?.hasAttribute("data-speaking")).toBe(
    true,
  );
  await act(async () => device.next());
  expect(speak.mock.calls.at(-1)?.[0].text).toBe("After.");
  expect(device.index).toBe(3);
  await act(async () => device.previous());
  expect(article.querySelector("table")?.hasAttribute("data-speaking")).toBe(
    true,
  );
  await act(async () => device.next());
  expect(speak.mock.calls.at(-1)?.[0].text).toBe("After.");
});

it("drops device preparation after Stop and reports a preparation failure without speaking raw source", async () => {
  let finish!: (text: string) => void;
  const prepare: TextPreparer = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await act(async () => root.render(<Device prepare={prepare} />));
  await act(async () => device.speakFrom(0));
  await act(async () => device.stop());
  await act(async () => finish("Late private text."));
  expect(speak).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      <Device
        prepare={async () => {
          throw new Error("Failed");
        }}
      />,
    ),
  );
  await act(async () => device.speakFrom(0));
  expect(device.error).toBeTruthy();
  expect(speak).not.toHaveBeenCalled();
});
