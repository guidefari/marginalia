/** How long the player's own scroll may take before we stop waiting for its `scrollend`. */
const OWN_SCROLL_MS = 1000;
/** Quiet time after the last frame of the player's scroll before it counts as finished, where `scrollend` isn't supported. */
const SETTLE_MS = 150;
/** Pixels of slack around the player's scroll path, for rounding and sub-pixel layout. */
const TOLERANCE = 2;

/** The reading line: 40% down the viewport, the line `useReadingPosition` uses. */
const READING_LINE = 0.4;
/** Clearance used where the page has no toolbar or bar to measure. */
const FALLBACK_MARGIN = 80;
const GAP = 8;

export interface Follower {
  /** Begins a listen: following again, and watching the page's scroll. */
  start(): void;
  /** Ends a listen: stops watching, and forgets which block was last shown. */
  stop(): void;
  /** Keeps the spoken position visible in oversized blocks. Progress is clamped to [0, 1]; omitting it retains this block's last value. */
  reveal(el: HTMLElement, progress?: number): void;
  /** Scrolls `el` to the reading line and follows again. */
  follow(el: HTMLElement | undefined): void;
  readonly following: boolean;
  /** Whether a listen is being watched, so a skip within it doesn't start over. */
  readonly active: boolean;
}

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The space the voice's block should sit in: below the fixed toolbar (its real
 * bottom edge, which includes the top safe-area inset) and above whichever of
 * the Listen pill and the phone's bottom bar is highest.
 */
function clearance() {
  const toolbar = document
    .querySelector(".reader-toolbar")
    ?.getBoundingClientRect();
  // Pinch zoom shrinks the visual viewport inside the layout one; rects are in
  // layout coordinates, so the visible band is [offsetTop, offsetTop + height].
  // Scrolling the document moves the layout viewport under it, not this offset,
  // so a target computed in this band stays visible after the scroll.
  const visual = window.visualViewport;
  const seenTop = visual ? visual.offsetTop : 0;
  const seenHeight = visual ? visual.height : window.innerHeight;
  const top = Math.max(
    toolbar && toolbar.bottom > 0
      ? Math.max(toolbar.bottom + GAP, FALLBACK_MARGIN)
      : FALLBACK_MARGIN,
    seenTop,
  );
  // The wrap, not the pill: it is laid out where the pill rests, while the pill
  // itself is shifted 12px mid-transition when it opens
  const lids = [".listen-wrap", ".mobile-reader-bar"]
    .map((selector) =>
      document.querySelector(selector)?.getBoundingClientRect(),
    )
    .filter((rect): rect is DOMRect => Boolean(rect && rect.height > 0))
    .map((rect) => rect.top)
    .filter((y) => y > 0);
  const bottom = Math.min(
    lids.length
      ? Math.min(...lids) - GAP
      : window.innerHeight - FALLBACK_MARGIN,
    seenTop + seenHeight,
  );
  // The reading line, 40% down what the reader can actually see
  return { top, bottom, line: seenTop + seenHeight * READING_LINE };
}

/** The furthest the document can scroll; unmeasured (no layout) means unlimited. */
function maxScroll() {
  const root = document.documentElement;
  return root.scrollHeight > 0
    ? Math.max(0, root.scrollHeight - (root.clientHeight || window.innerHeight))
    : Number.POSITIVE_INFINITY;
}

/**
 * D-TTS-012, D-TTS-029: the page follows the voice until it moves somewhere the
 * voice didn't send it. Only document scrolls are watched, not contained
 * scrollers. Unexplained movement releases following, but viewport changes and
 * layout/scroll anchoring do not. Input alone never releases following; actual
 * movement after scroll input does, even inside the player's smooth-scroll path.
 */
export function createFollower(onChange: () => void): Follower {
  let following = true;
  let watching = false;
  /**
   * The player's scroll in flight: the span of positions it may legitimately
   * pass through, and whether it has reached its target (after which it can only
   * stay there).
   */
  let flight: {
    lo: number;
    hi: number;
    target: number;
    arrived: boolean;
  } | null = null;
  let flightTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | null = null;
  /** The block the voice is on, which a change of viewport or clearance rechecks. */
  let current: HTMLElement | null = null;
  let progress = 0;
  let recheckFrame = 0;
  let recheckPending = false;
  let observer: ResizeObserver | undefined;
  let visual: VisualViewport | null | undefined;
  let lastY = 0;
  let geometry: number[] = [];
  let layoutUntil = 0;
  let inputUntil = 0;

  // Do not infer layout from rect.top alone: normal document scrolling changes
  // it too. These measurements also catch anchoring before ResizeObserver runs.
  const measure = () => {
    const { top, bottom, line } = clearance();
    return [
      top,
      bottom,
      line,
      window.innerHeight,
      document.documentElement.scrollHeight,
      current?.getBoundingClientRect().height ?? 0,
    ];
  };
  const layoutChanged = () => {
    const next = measure();
    const changed = next.some(
      (value, i) => Math.abs(value - (geometry[i] ?? value)) > TOLERANCE,
    );
    geometry = next;
    return changed;
  };

  const release = () => {
    if (!following) return;
    following = false;
    recheckPending = false;
    cancelAnimationFrame(recheckFrame);
    recheckFrame = 0;
    land();
    onChange();
  };
  const land = () => {
    flight = null;
    clearTimeout(flightTimer);
    clearTimeout(settleTimer);
    // A viewport change that arrived mid-flight was dropped: look again now
    if (recheckPending) {
      recheckPending = false;
      if (watching && following) recheckSoon();
    }
  };
  const onScroll = () => {
    const y = window.scrollY;
    const moved = y !== lastY;
    lastY = y;
    if (!following) return;
    const layout = layoutChanged();
    if (!moved) {
      if (layout) onLayout();
      return;
    }
    const manual = Date.now() < inputUntil;
    if (
      document.visibilityState === "hidden" ||
      (!manual && (layout || Date.now() < layoutUntil))
    ) {
      // Resize, image loading and browser chrome can move the document without
      // browsing intent. Re-measure after layout, rather than releasing Follow.
      if (flight) {
        flight.lo = Math.min(flight.lo, y);
        flight.hi = Math.max(flight.hi, y);
        flight.arrived = false;
        recheckPending = true;
      }
      recheckSoon();
      return;
    }
    if (manual) {
      release();
      return;
    }
    if (!flight) {
      release();
      return;
    }
    const atTarget = Math.abs(y - flight.target) <= TOLERANCE;
    // Off the path, or moving away from a target it had already reached: the reader
    if (
      y < flight.lo - TOLERANCE ||
      y > flight.hi + TOLERANCE ||
      (flight.arrived && !atTarget)
    ) {
      release();
      return;
    }
    if (atTarget) flight.arrived = true;
    // A smooth scroll keeps producing frames until it is done, so the player
    // keeps ownership until the page has been still for a moment (or `scrollend`)
    clearTimeout(settleTimer);
    settleTimer = setTimeout(land, SETTLE_MS);
  };

  /**
   * A tall block cannot fit in the band. Test the spoken point instead of both
   * edges, so rechecks never drag it back to its start or chase its bottom.
   */
  const ensureVisible = () => {
    if (!current || document.visibilityState === "hidden") return;
    const rect = current.getBoundingClientRect();
    const { top, bottom } = clearance();
    if (bottom <= top) return;
    const tall = rect.height > bottom - top;
    const point = rect.top + rect.height * progress;
    if (
      tall
        ? point < top - TOLERANCE || point > bottom + TOLERANCE
        : rect.top < top || rect.bottom > bottom
    ) {
      scrollTo(current);
    }
  };
  const recheck = () => {
    if (!following || !current) return;
    if (flight) {
      recheckPending = true;
      return;
    }
    ensureVisible();
    geometry = measure();
  };
  const recheckSoon = () => {
    cancelAnimationFrame(recheckFrame);
    recheckFrame = requestAnimationFrame(recheck);
  };
  const onLayout = () => {
    if (!watching || !following) return;
    // A bounded grace period covers scroll events delivered after resize/load.
    // Deliberate wheel/touch/key movement still takes precedence over it.
    layoutUntil = Date.now() + SETTLE_MS;
    recheckSoon();
  };
  const onVisualScroll = () => {
    if (layoutChanged()) onLayout();
  };
  const onVisibility = () => {
    if (document.visibilityState !== "hidden") onLayout();
  };
  const onInput = (event: Event) => {
    // Input inside a contained scroller must not claim an unrelated player frame.
    if (event.target instanceof Element) {
      let element: Element | null = event.target;
      while (
        element &&
        element !== document.body &&
        element !== document.documentElement
      ) {
        const style = getComputedStyle(element);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight
        ) {
          if (!(event instanceof WheelEvent)) return;
          const canConsume =
            event.deltaY > 0
              ? element.scrollTop + element.clientHeight < element.scrollHeight
              : event.deltaY < 0 && element.scrollTop > 0;
          if (
            canConsume ||
            event.deltaY === 0 ||
            /^(contain|none)$/.test(style.overscrollBehaviorY)
          )
            return;
          // At an edge, an uncontained wheel can chain into document browsing.
        }
        element = element.parentElement;
      }
    }
    // Native scrollbar presses target the root, unlike clicks in the article
    // or a contained settings scroller.
    if (
      event.type === "pointerdown" &&
      event.target !== document.documentElement
    )
      return;
    if (
      event instanceof KeyboardEvent &&
      ![
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
        "j",
        "J",
        "k",
        "K",
        "r",
        "Backspace",
      ].includes(event.key)
    )
      return;
    inputUntil = Date.now() + OWN_SCROLL_MS;
  };
  const setCurrent = (el: HTMLElement, next?: number) => {
    if (current !== el) {
      if (current) observer?.unobserve(current);
      current = el;
      progress = 0;
      observer?.observe(el);
      // Switching source blocks is not a layout change.
      geometry[5] = el.getBoundingClientRect().height;
    }
    if (next !== undefined) {
      progress = Number.isNaN(next) ? 0 : Math.max(0, Math.min(1, next));
    }
    if (layoutChanged()) onLayout();
  };

  function scrollTo(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const { top, bottom, line } = clearance();
    if (bottom <= top || document.visibilityState === "hidden") return;
    const height = rect.height;
    // Keep the existing placement for fitting blocks. For oversized blocks,
    // move the spoken point to the reading line without exposing space before
    // the block's beginning or after its end.
    const fits = height <= (bottom - top) * 0.6;
    const wanted =
      height > bottom - top
        ? Math.max(bottom - height, Math.min(top, line - height * progress))
        : fits
          ? Math.max(top, Math.min(line - height / 2, bottom - height))
          : top;
    const start = window.scrollY;
    // The browser clamps at the ends of the document; arming for a position it
    // can't reach would swallow the reader's scrolls when `scrollend` never comes
    const target = Math.min(
      maxScroll(),
      Math.max(0, start + rect.top - wanted),
    );
    if (Math.abs(target - start) < 1) return;
    flight = {
      lo: Math.min(start, target),
      hi: Math.max(start, target),
      target,
      arrived: false,
    };
    clearTimeout(flightTimer);
    clearTimeout(settleTimer);
    // `scrollend` isn't everywhere, and the position may never land exactly
    flightTimer = setTimeout(land, OWN_SCROLL_MS);
    // This command, not an earlier gesture which did not move the page, owns
    // the next scroll. New gestures during the animation can interrupt it.
    inputUntil = 0;
    lastY = start;
    geometry = measure();
    window.scrollTo({
      top: target,
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  }

  return {
    get following() {
      return following;
    },
    get active() {
      return watching;
    },
    start() {
      this.stop();
      // The caller publishes its own state right after starting, so no onChange here
      following = true;
      watching = true;
      lastY = window.scrollY;
      geometry = measure();
      visual = window.visualViewport;
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("scrollend", land);
      window.addEventListener("resize", onLayout);
      window.addEventListener("orientationchange", onLayout);
      window.addEventListener("wheel", onInput, { passive: true });
      window.addEventListener("touchmove", onInput, { passive: true });
      window.addEventListener("keydown", onInput);
      window.addEventListener("pointerdown", onInput, { passive: true });
      document.addEventListener("load", onLayout, true);
      document.addEventListener("visibilitychange", onVisibility);
      visual?.addEventListener("resize", onLayout);
      visual?.addEventListener("scroll", onVisualScroll);
      if (window.ResizeObserver) {
        observer = new window.ResizeObserver(() => {
          if (watching && layoutChanged()) onLayout();
        });
        for (const el of [
          document.documentElement,
          document.body,
          ...document.querySelectorAll(
            ".reader-toolbar, .listen-wrap, .mobile-reader-bar",
          ),
        ]) {
          observer.observe(el);
        }
      }
    },
    stop() {
      if (!watching) return;
      watching = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", land);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("orientationchange", onLayout);
      window.removeEventListener("wheel", onInput);
      window.removeEventListener("touchmove", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
      document.removeEventListener("load", onLayout, true);
      document.removeEventListener("visibilitychange", onVisibility);
      visual?.removeEventListener("resize", onLayout);
      visual?.removeEventListener("scroll", onVisualScroll);
      visual = null;
      observer?.disconnect();
      observer = undefined;
      cancelAnimationFrame(recheckFrame);
      recheckFrame = 0;
      recheckPending = false;
      current = null;
      land();
      shown = null;
      progress = 0;
      layoutUntil = 0;
      inputUntil = 0;
    },
    reveal(el, next) {
      if (!watching) return;
      setCurrent(el, next);
      if (!following) return;
      // The pill mounts after the first look, so look again once it has
      recheckSoon();
      if (shown === el) {
        // Progress can advance during a smooth scroll. Defer to its landing
        // instead of restarting the animation on every playback update.
        recheck();
        return;
      }
      shown = el;
      ensureVisible();
    },
    follow(el) {
      const was = following;
      following = true;
      if (el) {
        shown = el;
        setCurrent(el);
        scrollTo(el);
      }
      if (!was) onChange();
    },
  };
}
