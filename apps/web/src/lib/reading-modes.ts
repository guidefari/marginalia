"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceVoice } from "./device-voice";
import { clampSpeed, readSpeed, writeSpeed } from "./listen-speed";
import { createTextPreparer } from "./narration-preparation";
import {
  observeParagraphGeometry,
  paragraphGeometry,
} from "./paragraph-geometry";
import { getArticleBody } from "./paragraphs";
import { spokenTitle } from "./spoken-text";
import {
  type ClipSource,
  type ListenStatus,
  useNaturalVoice,
} from "./use-natural-voice";

export interface ReadingPosition {
  current: number | null;
  firstVisible: number | null;
  lastVisible: number | null;
}

/** Tracks which paragraph sits at the reading line (40% down the viewport) and marks it `data-current`. */
export function useReadingPosition(
  containerRef: React.RefObject<HTMLElement | null>,
  version: number,
): ReadingPosition {
  const [position, setPosition] = useState<ReadingPosition>({
    current: null,
    firstVisible: null,
    lastVisible: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` bumps whenever the article is re-tagged
  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!body) return;
    let marked: HTMLElement | null = null;

    const measure = () => {
      const geometry = paragraphGeometry(containerRef.current);
      if (!geometry) return;
      const paragraphs = geometry.elements;
      const line = window.innerHeight * 0.4;
      let current: number | null = null;
      let nearest = Number.POSITIVE_INFINITY;
      let firstVisible: number | null = null;
      let lastVisible: number | null = null;
      paragraphs.forEach((_el, i) => {
        const rect = geometry.rects[i];
        if (rect.bottom > 56 && rect.top < window.innerHeight) {
          firstVisible ??= i;
          lastVisible = i;
        }
        const distance =
          rect.top <= line && rect.bottom >= line
            ? 0
            : Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line));
        if (distance < nearest) {
          nearest = distance;
          current = i;
        }
      });
      const next = current === null ? null : paragraphs[current];
      if (marked !== next) {
        marked?.removeAttribute("data-current");
        next?.setAttribute("data-current", "");
        marked = next;
      }
      setPosition((p) =>
        p.current === current &&
        p.firstVisible === firstVisible &&
        p.lastVisible === lastVisible
          ? p
          : { current, firstVisible, lastVisible },
      );
    };

    const stop = observeParagraphGeometry(containerRef.current, measure);
    return () => {
      stop();
      marked?.removeAttribute("data-current");
    };
  }, [containerRef, version]);

  return position;
}

// "Use the device voice" holds for the browser session, not for good (D-TTS-013)
const DEVICE_CHOICE_KEY = "marginalia.listenVoice";

function readDeviceChoice(): boolean {
  try {
    return window.sessionStorage.getItem(DEVICE_CHOICE_KEY) === "device";
  } catch {
    return false;
  }
}

function writeDeviceChoice() {
  try {
    window.sessionStorage.setItem(DEVICE_CHOICE_KEY, "device");
  } catch {
    // Without storage the choice just lasts until the page closes
  }
}

/**
 * Reads the article aloud. Natural voices (the reader's OpenRouter key, through
 * `clipSource`) are used when the key is saved; the device voice is a named
 * fallback the reader chooses, never one we switch to on failure (D-TTS-013).
 */
export function useListen(
  containerRef: React.RefObject<HTMLElement | null>,
  articleId: string | undefined,
  unitKey: string | null | undefined,
  content: string | undefined,
  contentHtml: string | undefined,
  clipSource: ClipSource,
  heading?: { title: string; author?: string | null },
) {
  const capabilities = useQuery(api.providerCredentials.capabilities, {});
  const [deviceChosen, setDeviceChosen] = useState(readDeviceChoice);
  const [choosing, setChoosing] = useState(false);
  const [waitingDevice, setWaitingDevice] = useState<{
    index: number;
    paused: boolean;
  } | null>(null);
  const pendingStart = useRef<number | null>(null);
  // One speed for both voices, kept per browser (D-TTS-010)
  const [speed, setSpeedState] = useState(readSpeed);
  const setSpeed = useCallback((value: number) => {
    const next = clampSpeed(value);
    setSpeedState(next);
    writeSpeed(next);
  }, []);
  const prepareDevice = useMemo(
    () =>
      articleId ? createTextPreparer(articleId as Id<"articles">) : undefined,
    [articleId],
  );
  const device = useDeviceVoice(
    containerRef,
    articleId,
    unitKey,
    content,
    contentHtml,
    speed,
    capabilities && capabilities.providers.length > 0
      ? prepareDevice
      : undefined,
  );
  const natural = useNaturalVoice(
    containerRef,
    articleId,
    unitKey,
    content,
    contentHtml,
    clipSource,
    heading ? spokenTitle(heading.title, heading.author) : undefined,
    speed,
  );

  const mode: "natural" | "device" = deviceChosen ? "device" : "natural";
  // While the capabilities load we try the natural voice; a missing key then
  // arrives as the server's own sentence in the failed state
  const missingKey =
    mode === "natural" &&
    capabilities?.providers.includes("openrouter") === false;
  const voice = mode === "device" ? device : natural;

  const { stop: stopVoice, speakFrom: speakVoice } = voice;
  const speakFrom = useCallback(
    (start: number) => {
      pendingStart.current = start;
      if (mode === "device" && capabilities === undefined) {
        setWaitingDevice({ index: start, paused: false });
        return;
      }
      if (missingKey) {
        setChoosing(true);
        return;
      }
      setChoosing(false);
      setWaitingDevice(null);
      speakVoice(start);
    },
    [mode, capabilities, missingKey, speakVoice],
  );
  const stop = useCallback(() => {
    setChoosing(false);
    setWaitingDevice(null);
    pendingStart.current = null;
    stopVoice();
  }, [stopVoice]);

  // A reader without a key who pressed Listen before the capabilities loaded
  // started a natural listen that can only fail. Once the capabilities say so,
  // offer the same choice, from the same paragraph, instead of a Retry that
  // can't work. The device voice still starts only when they pick it.
  // A different article, part or prose makes the paragraph it would start at
  // meaningless, so the choice goes with it, next to the voices' own stops
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes clear the pending choice
  useEffect(() => {
    pendingStart.current = null;
    setChoosing(false);
    setWaitingDevice(null);
  }, [articleId, unitKey, content, contentHtml]);

  useEffect(() => {
    if (
      !waitingDevice ||
      waitingDevice.paused ||
      capabilities === undefined ||
      pendingStart.current !== waitingDevice.index
    )
      return;
    setWaitingDevice(null);
    device.speakFrom(waitingDevice.index);
  }, [waitingDevice, capabilities, device.speakFrom]);

  const { status: naturalStatus, stop: stopNatural } = natural;
  useEffect(() => {
    // No start to offer the choice for means the listen it would belong to is
    // gone: a change of article or prose cleared it in this same commit
    if (!missingKey || pendingStart.current === null) return;
    if (naturalStatus === "preparing" || naturalStatus === "failed") {
      stopNatural();
      setChoosing(true);
    }
  }, [missingKey, naturalStatus, stopNatural]);

  const chooseDeviceVoice = useCallback(() => {
    writeDeviceChoice();
    setDeviceChosen(true);
    setChoosing(false);
    if (pendingStart.current !== null) {
      if (capabilities === undefined)
        setWaitingDevice({ index: pendingStart.current, paused: false });
      else device.speakFrom(pendingStart.current);
    }
  }, [capabilities, device.speakFrom]);

  if (mode === "natural") {
    return {
      mode,
      supported: natural.supported,
      index: natural.index,
      paused: natural.paused,
      active: natural.active,
      status: natural.status,
      error: natural.error,
      speed,
      setSpeed,
      following: natural.following,
      follow: natural.follow,
      needsKey: choosing && missingKey,
      deviceSupported: device.supported,
      speakFrom,
      togglePause: natural.togglePause,
      stop,
      previous: natural.previous,
      next: natural.next,
      retry: natural.retry,
      chooseDeviceVoice,
    };
  }
  const status: ListenStatus = waitingDevice
    ? waitingDevice.paused
      ? "paused"
      : "preparing"
    : !device.active
      ? "idle"
      : device.error
        ? "failed"
        : device.paused
          ? "paused"
          : device.preparing
            ? "preparing"
            : "playing";
  return {
    mode,
    supported: device.supported,
    index: waitingDevice?.index ?? device.index,
    paused: waitingDevice?.paused ?? device.paused,
    active: Boolean(waitingDevice) || device.active,
    status,
    error: device.error,
    speed,
    setSpeed,
    following: device.following,
    follow: device.follow,
    needsKey: false,
    deviceSupported: device.supported,
    speakFrom,
    togglePause: waitingDevice
      ? () =>
          setWaitingDevice((waiting) =>
            waiting ? { ...waiting, paused: !waiting.paused } : null,
          )
      : device.togglePause,
    stop,
    previous: waitingDevice
      ? () => speakFrom(Math.max(0, waitingDevice.index - 1))
      : device.previous,
    next: waitingDevice
      ? () => speakFrom(waitingDevice.index + 1)
      : device.next,
    retry: device.retry,
    chooseDeviceVoice,
  };
}
