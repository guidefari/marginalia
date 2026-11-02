// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFollower, type Follower } from "./listen-follow";

let follower: Follower;
let y = 0;
let reduced = false;
let documentHeight = 12000;
let visibility = "visible";
const scrollTo = vi.fn();
const changed = vi.fn();
const observers: {
  callback: () => void;
  disconnect: () => void;
}[] = [];

function block(top: number, height: number) {
  const el = document.createElement("p");
  document.body.append(el);
  const box = { top, height };
  el.getBoundingClientRect = () => new DOMRect(0, box.top - y, 0, box.height);
  return { el, box };
}

function move(to: number) {
  y = to;
  window.dispatchEvent(new Event("scroll"));
}

function land() {
  window.dispatchEvent(new Event("scrollend"));
}

const frame = () => vi.advanceTimersByTimeAsync(20);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  y = 0;
  reduced = false;
  visibility = "visible";
  documentHeight = 12000;
  observers.length = 0;
  changed.mockReset();
  vi.stubGlobal("innerHeight", 1000);
  vi.stubGlobal("visualViewport", undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({
          callback: () => callback([], this),
          disconnect: this.disconnect,
        });
      }
    },
  );
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => y,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    get: () => window.innerHeight,
  });
  scrollTo.mockReset().mockImplementation((options: ScrollToOptions) => {
    move(options.top ?? 0);
  });
  vi.stubGlobal("scrollTo", scrollTo);
  follower = createFollower(changed);
  follower.start();
});

afterEach(() => {
  follower.stop();
  Reflect.deleteProperty(window, "scrollY");
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
  Reflect.deleteProperty(document.documentElement, "clientHeight");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("spoken progress within a source block", () => {
  it("does not mistake input inside a contained scroller for document browsing mid-flight", () => {
    scrollTo.mockImplementation(() => {});
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    const panel = document.createElement("div");
    panel.style.overflowY = "auto";
    Object.defineProperty(panel, "scrollHeight", { value: 600 });
    Object.defineProperty(panel, "clientHeight", { value: 100 });
    document.body.append(panel);
    panel.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 50 }));
    move(100);
    expect(follower.following).toBe(true);
  });
  it("keeps following repeated progress in one oversized block, including its end", async () => {
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    expect(y).toBe(1920);
    land();
    follower.reveal(el, 0.5);
    expect(y).toBe(2800);
    expect(el.getBoundingClientRect().top + 1200).toBe(400);
    land();
    follower.reveal(el, 1);
    expect(el.getBoundingClientRect().bottom).toBe(920);
    land();
    const end = y;
    for (let i = 0; i < 5; i++) {
      follower.reveal(el, 1);
      await frame();
      land();
    }
    expect(y).toBe(end);
    expect(scrollTo).toHaveBeenCalledTimes(3);
    expect(follower.following).toBe(true);
  });

  it("does not scroll repeatedly when a tall block has no progress yet", async () => {
    const { el } = block(2000, 2400);
    follower.reveal(el);
    land();
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event("resize"));
      await frame();
      land();
    }
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("leaves a visible spoken point still until progress exits the readable band", () => {
    const { el } = block(200, 2400);
    for (const progress of [0, 0.1, 0.3]) follower.reveal(el, progress);
    expect(scrollTo).not.toHaveBeenCalled();
    follower.reveal(el, 0.31);
    expect(el.getBoundingClientRect().top + 744).toBe(400);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("still follows progress and resize when ResizeObserver is unavailable", async () => {
    follower.stop();
    vi.stubGlobal("ResizeObserver", undefined);
    follower.start();
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    land();
    follower.reveal(el, 0.5);
    expect(el.getBoundingClientRect().top + 1200).toBe(400);
    land();
    window.dispatchEvent(new Event("resize"));
    await frame();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(follower.following).toBe(true);
  });

  it("clamps progress, handles NaN, and retains the last progress when omitted", () => {
    const { el } = block(2000, 2400);
    follower.reveal(el, -4);
    expect(y).toBe(1920);
    land();
    follower.reveal(el, 4);
    expect(el.getBoundingClientRect().bottom).toBe(920);
    land();
    follower.reveal(el);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    follower.reveal(el, Number.NaN);
    expect(el.getBoundingClientRect().top).toBe(80);
  });

  it("leaves fitting blocks still as progress advances and preserves reading-line placement", async () => {
    const { el } = block(2000, 80);
    follower.reveal(el, 0);
    expect(el.getBoundingClientRect().top + 40).toBe(400);
    land();
    for (const progress of [0.2, 0.5, 0.8, 1]) {
      follower.reveal(el, progress);
      await frame();
    }
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const medium = block(y + 1000, 600);
    follower.reveal(medium.el, 0.8);
    expect(medium.el.getBoundingClientRect().top).toBe(80);
    land();
    follower.reveal(medium.el, 1);
    await frame();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("resets progress across long and short source blocks", () => {
    follower.reveal(block(2000, 2400).el, 1);
    land();
    const short = block(5000, 80);
    follower.reveal(short.el, 0.7);
    expect(short.el.getBoundingClientRect().top + 40).toBe(400);
    land();
    const next = block(6000, 2400);
    follower.reveal(next.el);
    expect(next.el.getBoundingClientRect().top).toBe(80);
  });

  it("uses instant scrolling for reduced motion, including intra-block movement", () => {
    reduced = true;
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    land();
    follower.reveal(el, 0.75);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    for (const [options] of scrollTo.mock.calls) {
      expect(options.behavior).toBe("instant");
    }
    expect(follower.following).toBe(true);
  });

  it("defers repeated progress until a smooth scroll lands, then uses the latest point", async () => {
    scrollTo.mockImplementation(() => undefined);
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    const first = scrollTo.mock.calls[0][0].top;
    for (const progress of [0.2, 0.4, 0.6, 0.8]) {
      follower.reveal(el, progress);
      await frame();
    }
    expect(scrollTo).toHaveBeenCalledTimes(1);
    for (const position of [500, 1200, first]) {
      move(position);
      expect(follower.following).toBe(true);
    }
    land();
    await frame();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    const next = scrollTo.mock.calls[1][0].top;
    move(next - 50);
    move(next);
    // Near the end, keep the block's bottom in the band instead of exposing
    // blank space just to force its spoken point onto the reading line.
    expect(el.getBoundingClientRect().top + 2400 * 0.8).toBe(440);
    expect(el.getBoundingClientRect().bottom).toBe(920);
    expect(follower.following).toBe(true);
    land();
    move(next + 20);
    expect(follower.following).toBe(false);
  });

  it("clamps oversized progress to the document end without swallowing later browsing", async () => {
    documentHeight = 4500;
    follower.reveal(block(4000, 2400).el, 1);
    expect(y).toBe(3500);
    land();
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event("resize"));
      await frame();
    }
    expect(scrollTo).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("wheel"));
    move(3400);
    expect(follower.following).toBe(false);
  });

  it("ignores a scroll event with no document movement", () => {
    follower.reveal(block(300, 80).el);
    window.dispatchEvent(new Event("scroll"));
    expect(follower.following).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps following browser scroll anchoring after an image grows above the voice", async () => {
    const { el, box } = block(300, 80);
    follower.reveal(el);
    await frame();
    documentHeight += 500;
    box.top += 500;
    move(500);
    expect(follower.following).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
    await frame();
    expect(el.getBoundingClientRect().top).toBe(300);
  });

  it("rechecks image loads and ResizeObserver changes without a continuous timer", async () => {
    const { el, box } = block(300, 80);
    follower.reveal(el, 0.75);
    await frame();
    box.height = 2400;
    for (const observer of observers) {
      observer.callback();
    }
    await frame();
    expect(el.getBoundingClientRect().top + 1800).toBe(400);
    land();
    box.top += 1200;
    const image = document.createElement("img");
    document.body.append(image);
    image.dispatchEvent(new Event("load"));
    await frame();
    expect(el.getBoundingClientRect().top + 1800).toBe(400);
    land();
    const count = scrollTo.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(scrollTo).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks viewport shrink and its browser-driven document movement", async () => {
    const { el } = block(500, 80);
    follower.reveal(el);
    await frame();
    vi.stubGlobal("innerHeight", 500);
    // Browser scroll adjustment may precede its resize event.
    move(20);
    expect(follower.following).toBe(true);
    window.dispatchEvent(new Event("resize"));
    await frame();
    expect(el.getBoundingClientRect().top + 40).toBe(200);
    expect(follower.following).toBe(true);
  });

  it("keeps progress between the toolbar, pill, and panned visual viewport", async () => {
    follower.stop();
    const visual = Object.assign(new EventTarget(), {
      offsetTop: 100,
      height: 700,
    });
    vi.stubGlobal("visualViewport", visual);
    const toolbar = document.createElement("div");
    const pill = document.createElement("div");
    toolbar.className = "reader-toolbar";
    pill.className = "listen-wrap";
    toolbar.getBoundingClientRect = () => new DOMRect(0, 0, 0, 120);
    pill.getBoundingClientRect = () => new DOMRect(0, 750, 0, 60);
    document.body.append(toolbar, pill);
    follower.start();
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    expect(el.getBoundingClientRect().top).toBe(128);
    land();
    follower.reveal(el, 1);
    expect(el.getBoundingClientRect().bottom).toBe(742);
    land();
    visual.offsetTop = 450;
    visual.height = 250;
    visual.dispatchEvent(new Event("scroll"));
    await frame();
    expect(el.getBoundingClientRect().bottom).toBe(700);
    expect(follower.following).toBe(true);
  });

  it("uses the latest progress when returning from a hidden page", async () => {
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    land();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    follower.reveal(el, 0.8);
    move(0);
    await frame();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(follower.following).toBe(true);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await frame();
    expect(el.getBoundingClientRect().top + 1920).toBe(440);
  });

  it.each([
    "wheel",
    "touchmove",
    "keydown",
    "pointerdown",
  ])("honors deliberate %s movement during smooth scrolling and layout grace", (type) => {
    scrollTo.mockImplementation(() => undefined);
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    window.dispatchEvent(new Event("resize"));
    const target = type === "pointerdown" ? document.documentElement : window;
    target.dispatchEvent(
      type === "keydown"
        ? new KeyboardEvent(type, { key: "PageDown" })
        : new Event(type, { bubbles: true }),
    );
    expect(follower.following).toBe(true);
    move(200);
    expect(follower.following).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    follower.reveal(el, 0.9);
    follower.reveal(block(8000, 80).el, 0.5);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("retains progress while browsing and resumes only with explicit Follow", () => {
    const { el } = block(2000, 2400);
    follower.reveal(el, 0);
    land();
    move(0);
    expect(follower.following).toBe(false);
    follower.reveal(el, 0.8);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    follower.follow(el);
    expect(el.getBoundingClientRect().top + 1920).toBe(440);
    expect(follower.following).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("disconnects observers, frames, timers, and viewport listeners on stop", async () => {
    follower.stop();
    const visual = Object.assign(new EventTarget(), {
      offsetTop: 0,
      height: 1000,
    });
    const remove = vi.spyOn(visual, "removeEventListener");
    vi.stubGlobal("visualViewport", visual);
    follower.start();
    follower.reveal(block(2000, 2400).el, 0);
    follower.stop();
    expect(
      observers.every(
        (observer) => vi.mocked(observer.disconnect).mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(remove.mock.calls.map(([event]) => event)).toEqual([
      "resize",
      "scroll",
    ]);
    const count = scrollTo.mock.calls.length;
    documentHeight += 1000;
    window.dispatchEvent(new Event("resize"));
    visual.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("visibilitychange"));
    for (const observer of observers) observer.callback();
    follower.reveal(block(6000, 2400).el, 0.8);
    move(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(scrollTo).toHaveBeenCalledTimes(count);
    expect(follower.following).toBe(true);
    expect(follower.active).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
