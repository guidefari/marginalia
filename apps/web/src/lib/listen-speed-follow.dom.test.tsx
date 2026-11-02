// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListen } from "./reading-modes";
import type { ClipSource } from "./use-natural-voice";

vi.mock("convex/react", () => ({
  useQuery: () => ({ providers: ["openrouter"] }),
}));
vi.mock("./narration-preparation", () => ({
  createTextPreparer: () => async (text: string) => text,
}));

// Like a browser, loading a new src puts playbackRate back to defaultPlaybackRate
class FakeAudio {
  static all: FakeAudio[] = [];
  currentTime = 0;
  preservesPitch = false;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  private source = "";
  private handlers = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.all.push(this);
  }
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.playbackRate = this.defaultPlaybackRate;
  }
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute(name: string) {
    if (name === "src") this.source = "";
  }
  addEventListener(type: string, fn: () => void) {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn);
    this.handlers.set(type, set);
  }
  fire(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
}

let resolvers: (() => void)[] = [];
const source: ClipSource = (text) =>
  new Promise<Blob>((resolve) => {
    resolvers.push(() => resolve(new Blob([text], { type: "audio/mpeg" })));
  });

let root: Root;
let article: HTMLElement;
let listen: ReturnType<typeof useListen>;
const speak = vi.fn();
class Utterance {
  rate = 1;
  constructor(public text: string) {}
}
const scrollTo = vi.fn();
let scrollY = 0;
let reduced = false;
const store = new Map<string, string>();

function Harness() {
  listen = useListen({ current: article }, "a1", "u1", "prose", "", source);
  return null;
}

function mountArticle(count = 6) {
  document.body.innerHTML = `<article><div data-article-body>${Array.from(
    { length: count },
    (_v, i) =>
      `<p data-para="${i + 1}">Paragraph ${i} says one plain thing.</p>`,
  ).join("")}</div></article><div id="mount"></div>`;
  article = document.querySelector("article") as HTMLElement;
  root = createRoot(document.getElementById("mount") as HTMLElement);
  // In view by default, so only a test that places a block out of view sees a scroll
  for (let i = 0; i < count; i++) place(i, 300);
}
const para = (n: number) =>
  article.querySelectorAll("[data-para]")[n] as HTMLElement;
/** Puts a paragraph's top at `top` px in the viewport. */
function place(n: number, top: number, height = 80) {
  para(n).getBoundingClientRect = () =>
    ({ top, bottom: top + height, height }) as DOMRect;
}
const audio = () => FakeAudio.all[0];
const render = () => act(async () => root.render(<Harness />));
const start = (block: number) => act(async () => listen.speakFrom(block));
const settle = (n: number) => act(async () => resolvers[n]());
const ended = () => act(async () => audio().fire("ended"));
const elapse = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const scrollEnd = () =>
  act(async () => {
    window.dispatchEvent(new Event("scrollend"));
  });
/** The document scroller moves to `y`, whoever moved it. */
const scrollTo_ = (y: number) =>
  act(async () => {
    scrollY = y;
    window.dispatchEvent(new Event("scroll"));
  });
const scrollByUser = (y = 50) => scrollTo_(y);
/** The player's scrolls land at once, as with reduced motion. */
const instant = () =>
  scrollTo.mockImplementation((options: ScrollToOptions) => {
    scrollY = options.top ?? 0;
    window.dispatchEvent(new Event("scroll"));
  });
/** The player's scrolls are smooth: the test moves the page itself. */
const smooth = () => scrollTo.mockImplementation(() => undefined);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel: vi.fn(),
    getVoices: () => [],
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  FakeAudio.all = [];
  resolvers = [];
  store.clear();
  reduced = false;
  speak.mockClear();
  scrollY = 0;
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => scrollY,
  });
  scrollTo.mockReset();
  instant();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  window.sessionStorage.clear();
  URL.createObjectURL = () => `blob:${Math.random()}`;
  URL.revokeObjectURL = () => undefined;
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => {
    for (const resolve of resolvers) resolve();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("speed", () => {
  it("starts at 1x and applies a new speed to the clip already playing", async () => {
    mountArticle();
    await render();
    expect(listen.speed).toBe(1);
    await start(0);
    await settle(0);
    expect(audio().playbackRate).toBe(1);
    await act(async () => listen.setSpeed(1.5));
    expect(listen.speed).toBe(1.5);
    expect(audio().playbackRate).toBe(1.5);
    expect(audio().preservesPitch).toBe(true);
  });

  it("carries the speed to the next clip even though loading a src resets the rate", async () => {
    mountArticle();
    await render();
    await start(0);
    await settle(0);
    await act(async () => listen.setSpeed(1.75));
    await settle(1);
    await ended();
    await elapse(400);
    expect(audio().src).not.toBe("");
    expect(audio().playbackRate).toBe(1.75);
  });

  it("applies the speed to a listen that starts after it was set", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(1.2));
    await start(0);
    await settle(0);
    expect(audio().playbackRate).toBe(1.2);
  });

  it("clamps to 0.8 to 2 on the 0.05 grid", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(5));
    expect(listen.speed).toBe(2);
    await act(async () => listen.setSpeed(0.1));
    expect(listen.speed).toBe(0.8);
    await act(async () => listen.setSpeed(1.23));
    expect(listen.speed).toBe(1.25);
  });

  it("is kept with the other reader settings in the browser, and read back next time", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(1.5));
    expect(store.get("marginalia.listenSpeed")).toBe("1.5");
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("mount") as HTMLElement);
    await render();
    expect(listen.speed).toBe(1.5);
  });

  it("falls back to 1x from a bad stored value, and still works when storage is blocked", async () => {
    store.set("marginalia.listenSpeed", "fast");
    mountArticle();
    await render();
    expect(listen.speed).toBe(1);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    await act(async () => listen.setSpeed(1.2));
    expect(listen.speed).toBe(1.2);
  });

  it("shortens the gap between paragraphs with the speed", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(2));
    await start(0);
    await settle(0);
    await ended();
    expect(listen.status).toBe("gap");
    await elapse(170);
    expect(listen.status).toBe("gap");
    await elapse(10);
    expect(listen.status).not.toBe("gap");
  });

  it("gives the device voice the speed from the next paragraph", async () => {
    window.sessionStorage.setItem("marginalia.listenVoice", "device");
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(1.5));
    await start(0);
    expect((speak.mock.calls[0][0] as Utterance).rate).toBe(1.5);
  });
});

describe("following", () => {
  it("follows at the start, and the player's own scroll doesn't end it", async () => {
    mountArticle();
    place(2, 2000);
    await render();
    await start(2);
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(listen.following).toBe(true);
  });

  it("brings the block to the reading line, instantly when the reader prefers reduced motion, without ending following", async () => {
    reduced = true;
    mountArticle();
    place(1, 1500, 80);
    await render();
    await start(1);
    const call = scrollTo.mock.calls[0][0] as ScrollToOptions;
    expect(call.behavior).toBe("instant");
    // The block's middle lands 40% down the viewport
    expect(call.top).toBe(1500 + 40 - window.innerHeight * 0.4);
    expect(listen.following).toBe(true);
    // Once landed (the page has been still for a moment), the next scroll is the reader's
    await elapse(200);
    await scrollByUser(0);
    expect(listen.following).toBe(false);
  });

  it("eases the scroll when motion is welcome", async () => {
    mountArticle();
    place(1, 1500);
    smooth();
    await render();
    await start(1);
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).behavior).toBe(
      "smooth",
    );
  });

  it("leaves a block that is already in view where it is", async () => {
    mountArticle();
    place(1, 300);
    await render();
    await start(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls at most once per block", async () => {
    mountArticle();
    place(1, 1500);
    await render();
    await start(1);
    await settle(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("a voice-driven smooth scroll, through several positions on its path, doesn't unfollow", async () => {
    mountArticle();
    place(0, 2000);
    smooth();
    await render();
    await start(0);
    const target = 2000 + 40 - window.innerHeight * 0.4;
    for (const y of [120, 600, 1200, target - 10, target]) {
      await scrollTo_(y);
      expect(listen.following).toBe(true);
    }
    // It has landed: anything after is the reader's
    await scrollTo_(target + 300);
    expect(listen.following).toBe(false);
  });

  it("keeps ownership through the final frames of a smooth scroll that has no scrollend", async () => {
    mountArticle();
    place(0, 2000);
    smooth();
    await render();
    await start(0);
    const target = 2000 + 40 - window.innerHeight * 0.4;
    // The block moves with the page, so a premature end of ownership would
    // show as a second scroll from the recheck, not hide behind a stale rect
    for (const y of [target - 40, target - 2, target - 1, target]) {
      await scrollTo_(y);
      place(0, 2000 - y);
      await elapse(16);
      expect(listen.following).toBe(true);
    }
    // Still for a moment: it has finished, and the next scroll is the reader's
    await elapse(200);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await scrollTo_(target + 20);
    expect(listen.following).toBe(false);
  });

  it("clamps the target to what the document can scroll, so a reader's scroll after arriving unfollows", async () => {
    const root = document.documentElement;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 800,
    });
    try {
      mountArticle();
      // Asks for 1570, but the document ends at 1200
      place(0, 1570 - 800 + 267.2);
      smooth();
      scrollY = 800;
      await render();
      await start(0);
      expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBe(1200);
      await scrollTo_(1000);
      await scrollTo_(1200);
      expect(listen.following).toBe(true);
      await elapse(100);
      await scrollTo_(1100);
      expect(listen.following).toBe(false);
    } finally {
      Reflect.deleteProperty(root, "scrollHeight");
      Reflect.deleteProperty(root, "clientHeight");
    }
  });

  it("doesn't arm a scroll that can't move, so the reader's next scroll isn't swallowed", async () => {
    const root = document.documentElement;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 800,
    });
    try {
      mountArticle();
      place(0, 2000);
      smooth();
      scrollY = 1200;
      await render();
      await start(0);
      expect(scrollTo).not.toHaveBeenCalled();
      await scrollTo_(1100);
      expect(listen.following).toBe(false);
    } finally {
      Reflect.deleteProperty(root, "scrollHeight");
      Reflect.deleteProperty(root, "clientHeight");
    }
  });

  it("lands a tall paragraph below the phone toolbar, safe-area inset included", async () => {
    const height = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 852,
    });
    try {
      mountArticle();
      // The toolbar takes 119px: 59 of inset and 60 of bar
      const toolbar = document.createElement("div");
      toolbar.className = "reader-toolbar";
      toolbar.getBoundingClientRect = () =>
        ({ top: 0, bottom: 119 }) as DOMRect;
      document.body.append(toolbar);
      place(0, 2000, 500);
      await render();
      await start(0);
      const top = (scrollTo.mock.calls[0][0] as ScrollToOptions).top ?? 0;
      // Where the block's top lands on screen
      expect(2000 - top).toBeGreaterThanOrEqual(119);
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: height,
      });
    }
  });

  it("looks again once the pill has mounted, so the first paragraph isn't left under it", async () => {
    mountArticle();
    const bar = document.createElement("nav");
    bar.className = "mobile-reader-bar";
    bar.getBoundingClientRect = () =>
      ({ top: 767, bottom: 852, height: 85 }) as DOMRect;
    document.body.append(bar);
    // Clear of the bar, but the pill isn't there yet to be measured
    place(0, 300, 430);
    await render();
    await start(0);
    expect(scrollTo).not.toHaveBeenCalled();
    const wrap = document.createElement("div");
    wrap.className = "listen-wrap";
    wrap.getBoundingClientRect = () =>
      ({ top: 695, bottom: 747, height: 52 }) as DOMRect;
    document.body.append(wrap);
    await elapse(20);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(listen.following).toBe(true);
  });

  it("rechecks the current block when the viewport changes, without unfollowing or restarting", async () => {
    mountArticle();
    place(0, 300, 120);
    await render();
    await start(0);
    await settle(0);
    expect(scrollTo).not.toHaveBeenCalled();
    const plays = audio().play.mock.calls.length;
    // The window shrinks: a bar now rises behind the paragraph
    const bar = document.createElement("nav");
    bar.className = "mobile-reader-bar";
    bar.getBoundingClientRect = () =>
      ({ top: 340, bottom: 390, height: 50 }) as DOMRect;
    document.body.append(bar);
    for (const event of ["resize", "orientationchange"]) {
      scrollTo.mockClear();
      await act(async () => {
        window.dispatchEvent(new Event(event));
      });
      await elapse(20);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(listen.following).toBe(true);
      await scrollEnd();
    }
    expect(audio().play.mock.calls.length).toBe(plays);
    expect(listen.status).toBe("playing");
  });

  it("a viewport change during the voice's scroll is rechecked once the scroll has landed", async () => {
    mountArticle();
    place(0, 2000);
    smooth();
    await render();
    await start(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The window shrinks mid-scroll, and a bar rises behind where it is headed
    const bar = document.createElement("nav");
    bar.className = "mobile-reader-bar";
    bar.getBoundingClientRect = () =>
      ({ top: 340, bottom: 390, height: 50 }) as DOMRect;
    document.body.append(bar);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    await elapse(20);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await scrollEnd();
    await elapse(20);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(listen.following).toBe(true);
  });

  it("measures visibility and the reading line inside the visual viewport when pinch zoom shrinks it", async () => {
    vi.stubGlobal("visualViewport", {
      offsetTop: 100,
      height: 450,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    mountArticle();
    // In the layout viewport, but below the 100-550 the reader can see
    place(0, 600, 100);
    await render();
    await start(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const top = (scrollTo.mock.calls[0][0] as ScrollToOptions).top ?? 0;
    // Lands on the reading line of the visible band: 40% of 450 below its top
    expect(600 - top).toBe(100 + 450 * 0.4 - 50);
    expect(600 - top).toBeGreaterThanOrEqual(100);
    expect(600 - top + 100).toBeLessThanOrEqual(550);
    expect(listen.following).toBe(true);
  });

  it("leaves a block that is inside the visual viewport alone", async () => {
    vi.stubGlobal("visualViewport", {
      offsetTop: 100,
      height: 450,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    mountArticle();
    place(0, 300, 100);
    await render();
    await start(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("doesn't recheck once the reader has scrolled away", async () => {
    mountArticle();
    place(0, 300, 120);
    await render();
    await start(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    const bar = document.createElement("nav");
    bar.className = "mobile-reader-bar";
    bar.getBoundingClientRect = () =>
      ({ top: 340, bottom: 390, height: 50 }) as DOMRect;
    document.body.append(bar);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    await elapse(20);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("keeps a block that fits clear of the phone's bottom bar", async () => {
    mountArticle();
    const bar = document.createElement("nav");
    bar.className = "mobile-reader-bar";
    bar.getBoundingClientRect = () =>
      ({ top: 700, bottom: 768, height: 68 }) as DOMRect;
    document.body.append(bar);
    // Its bottom edge at 720 sits behind the bar, so the voice scrolls to it
    place(0, 640, 80);
    await render();
    await start(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("a reader's scroll in the opposite direction, or past the target, during the voice's scroll unfollows", async () => {
    mountArticle();
    place(0, 2000);
    smooth();
    scrollY = 1000;
    await render();
    await start(0);
    await scrollTo_(1500);
    expect(listen.following).toBe(true);
    await scrollTo_(200);
    expect(listen.following).toBe(false);

    await act(async () => listen.stop());
    scrollY = 0;
    await start(0);
    await scrollTo_(900);
    expect(listen.following).toBe(true);
    // Scroll anchoring or the reader pushing past where the voice is headed
    await scrollTo_(5000);
    expect(listen.following).toBe(false);
  });

  it("any scroll after the voice's scroll has ended is the reader's, even on its old path", async () => {
    mountArticle();
    place(0, 2000);
    smooth();
    await render();
    await start(0);
    await scrollTo_(400);
    await scrollEnd();
    await scrollTo_(500);
    expect(listen.following).toBe(false);
  });

  it("stops expecting the voice's scroll after a second, where scrollend isn't supported", async () => {
    mountArticle();
    place(0, 2000);
    smooth();
    await render();
    await start(0);
    // The block has reached view by the time the second is up
    place(0, 300);
    await elapse(1100);
    await scrollTo_(400);
    expect(listen.following).toBe(false);
  });

  it("the reader's scroll ends following, and the player stops scrolling", async () => {
    mountArticle();
    place(0, 300);
    place(1, 2000);
    await render();
    await start(0);
    await settle(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    await settle(1);
    await ended();
    await elapse(400);
    expect(listen.index).toBe(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("decides from the page's movement, not from keys or gestures that don't move it", async () => {
    mountArticle();
    place(0, 300);
    await render();
    await start(0);
    const field = document.createElement("input");
    document.body.append(field);
    await act(async () => {
      for (const key of ["j", "J", "k", " ", "ArrowDown", "PageDown", "r", "o"])
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      window.dispatchEvent(new Event("wheel"));
      window.dispatchEvent(new Event("touchmove"));
      window.dispatchEvent(new Event("pointerdown"));
      document.documentElement.dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });
    expect(listen.following).toBe(true);
  });

  it("ignores scrolls of a contained scroller, such as the settings panel, and a slider drag", async () => {
    mountArticle();
    place(0, 300);
    await render();
    await start(0);
    const panel = document.createElement("div");
    const slider = document.createElement("input");
    slider.type = "range";
    panel.append(slider);
    document.body.append(panel);
    await act(async () => {
      // Scroll events from an element don't bubble to the window
      panel.dispatchEvent(new Event("scroll"));
      panel.dispatchEvent(new Event("wheel", { bubbles: true }));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(listen.following).toBe(true);
  });

  it("a sidenote that opens in the margin, moving nothing, leaves Follow on", async () => {
    mountArticle();
    place(0, 300);
    await render();
    await start(0);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "o" }));
    });
    expect(listen.following).toBe(true);
  });

  it("j, Shift+J, r, Backspace, arrows and PageDown unfollow when they move the page, inside the voice's scroll or after it", async () => {
    mountArticle();
    place(0, 2000);
    place(1, 300);
    smooth();
    await render();
    for (const key of ["j", "J", "r", "Backspace", "ArrowDown", "PageDown"]) {
      // Inside the voice's scroll window, to a place off its path
      scrollY = 0;
      await act(async () => listen.stop());
      await start(0);
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      });
      await scrollTo_(4000);
      expect(listen.following).toBe(false);
      // After it has landed
      await act(async () => listen.stop());
      scrollY = 0;
      await start(0);
      await scrollEnd();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      });
      await scrollTo_(600);
      expect(listen.following).toBe(false);
    }
  });

  it("Follow scrolls the speaking block to the reading line and follows again", async () => {
    mountArticle();
    place(0, 300);
    place(1, 300);
    place(2, 2000);
    await render();
    await start(0);
    await settle(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    // The reader has scrolled a long way down; the voice is still on paragraph 0
    place(0, -900);
    await act(async () => listen.follow());
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBe(0);

    // Following again, so the voice reaching a block out of view scrolls to it
    await act(async () => listen.next());
    await act(async () => listen.next());
    expect(listen.index).toBe(2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(listen.following).toBe(true);
  });

  it("keeps not following across paragraph skips until Follow is pressed", async () => {
    mountArticle();
    place(0, 300);
    place(1, 2000);
    await render();
    await start(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    await act(async () => listen.next());
    expect(listen.following).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("follows again at the next listen, and stops watching the page when it ends", async () => {
    mountArticle();
    await render();
    await start(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    await act(async () => listen.stop());
    expect(listen.following).toBe(true);
    await start(0);
    expect(listen.following).toBe(true);
    await act(async () => listen.stop());
    await scrollByUser();
    expect(listen.following).toBe(true);
  });

  it("does the same for the device voice", async () => {
    window.sessionStorage.setItem("marginalia.listenVoice", "device");
    mountArticle();
    place(0, 2000);
    place(1, 2000);
    smooth();
    await render();
    await start(0);
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await scrollTo_(400);
    expect(listen.following).toBe(true);
    await scrollEnd();
    await scrollTo_(900);
    expect(listen.following).toBe(false);
    // Skipping on the device voice doesn't quietly follow again
    await act(async () => listen.next());
    expect(listen.following).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => listen.follow());
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
