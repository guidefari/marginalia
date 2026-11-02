"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useConvex, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArticleFinder } from "@/components/article-finder";
import { BibleDiscovery, BibleTimePick } from "@/components/bible-discovery";
import { DeskPick } from "@/components/desk/desk-pick";
import { ContinueShortcut, DeskRest } from "@/components/desk/desk-rest";
import { ImportSlot } from "@/components/desk/import-slot";
import { PdfDrop } from "@/components/desk/pdf-drop";
import { QueryBoundary } from "@/components/desk/query-boundary";
import { type Fits, TimeChoices } from "@/components/desk/time-choices";
import { parseDeskLink } from "@/lib/desk-link";
import { useShortcuts } from "@/lib/shortcuts";
import { arrivedFromFinish } from "@/lib/title-handoff";
import { useAltHint } from "@/lib/use-alt-hint";
import { usePdfImport } from "@/lib/use-pdf-import";

// A repeat of the same choice this soon is a double click, not a toggle off
export const DOUBLE_CHOICE_MS = 400;
// How long a prefetched answer stays subscribed after hover or focus
const PREFETCH_FOR_MS = 15_000;

type Chosen = {
  minutes: number;
  /** A new choice is a new deck and a new session, even for the same time. */
  key: number;
  /** Set when a deep link brought a session that already exists. */
  sessionId?: Id<"sessions">;
};

const TIME_KEYS = { "1": 5, "2": 10, "3": 20, "4": 30 } as const;

/** Counts of what fits each window, for the tooltips only. */
function TimesWithFits(props: Omit<Parameters<typeof TimeChoices>[0], "fits">) {
  const overview = useQuery(api.home.counts, {});
  const fits: Fits | undefined = overview?.fits;
  return <TimeChoices {...props} fits={fits} />;
}

function Desk() {
  const bible = useQuery(api.bible.preferences, {});
  const convex = useConvex();
  const params = useSearchParams();
  const showKeys = useAltHint();
  const link = parseDeskLink(params);
  const pdf = usePdfImport();
  // Armed by a file dropped or picked here; anything else the reader starts
  // (a time, a typed ask, a new link) disarms it, so a PDF never snatches them
  // away from what they chose since.
  const [armed, setArmed] = useState(false);
  const startPdf = (file: File) => {
    setArmed(true);
    void pdf.start(file);
  };
  // Done brought us here: the slot slides its next pick in (globals.css)
  const [arrival, setArrival] = useState(() =>
    !arrivedFromFinish()
      ? undefined
      : typeof document.startViewTransition === "function"
        ? "finish"
        : "finish-swap",
  );
  useEffect(() => {
    if (!arrival) return;
    // The initial finish handoff lasts 320ms + 240ms. Later picks arrive normally.
    const timer = window.setTimeout(() => setArrival(undefined), 560);
    return () => window.clearTimeout(timer);
  }, [arrival]);
  const keyCounter = useRef(0);
  const lastChoice = useRef<{ minutes: number; at: number } | null>(null);

  const fromLink = (): Chosen | null =>
    link ? { ...link, key: ++keyCounter.current } : null;
  const [chosen, setChosen] = useState<Chosen | null>(fromLink);
  // A new deep link (such as the wordmark back to `/`) replaces what was chosen
  const [seenUrl, setSeenUrl] = useState(params.toString());
  if (seenUrl !== params.toString()) {
    setSeenUrl(params.toString());
    setChosen(fromLink());
    setArmed(false);
  }

  const choose = (minutes: number) => {
    setArrival(undefined);
    const now = Date.now();
    const last = lastChoice.current;
    if (last?.minutes === minutes && now - last.at < DOUBLE_CHOICE_MS) return;
    lastChoice.current = { minutes, at: now };
    setArmed(false);
    setChosen(
      chosen?.minutes === minutes
        ? null
        : { minutes, key: ++keyCounter.current },
    );
  };

  // prewarmQuery holds a live subscription, which is what the pick's own
  // useQuery reads from; a one-off client.query would not fill that cache
  const prefetch = (requestedMinutes: number) =>
    convex.prewarmQuery({
      query: api.suggestions.forWindow,
      args: { requestedMinutes },
      extendSubscriptionFor: PREFETCH_FOR_MS,
    });

  useShortcuts(
    {
      "1": () => choose(TIME_KEYS["1"]),
      "2": () => choose(TIME_KEYS["2"]),
      "3": () => choose(TIME_KEYS["3"]),
      "4": () => choose(TIME_KEYS["4"]),
      Escape: () => (chosen ? setChosen(null) : false),
    },
    true,
    {
      help: {
        group: "Desk",
        keys: [
          ["1 – 4", "Read for 5, 10, 20 or 30+ minutes"],
          ["Esc", "Clear the chosen time"],
        ],
      },
    },
  );

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const timeProps = {
    chosen: chosen?.minutes ?? null,
    showKeys,
    onChoose: choose,
    onIntent: prefetch,
  };

  return (
    <main className="mx-auto w-full max-w-[760px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3.5rem)] pb-[clamp(1rem,3vh,2rem)] flex flex-col gap-y-[clamp(1rem,3vh,1.75rem)]">
      <div>
        <p className="text-[13px] text-[var(--ink-muted)] [@media(max-height:699px)]:hidden">
          {today}
        </p>
        <h1 className="mt-3 font-serif font-light tracking-tight leading-[1.02] text-[clamp(3rem,6vw,4.5rem)]">
          How much time
          <br className="hidden sm:block" /> do you have?
        </h1>
      </div>

      <QueryBoundary fallback={() => <TimeChoices {...timeProps} />}>
        <TimesWithFits {...timeProps} />
      </QueryBoundary>

      <BibleDiscovery preferences={bible} />
      <ArticleFinder
        onPdf={startPdf}
        onType={() => setArmed(false)}
        showKey={showKeys}
        windowMinutes={chosen?.minutes ?? null}
        onClearWindow={() => setChosen(null)}
        scope={bible?.enabled ? bible.scope : "articles"}
        translation={bible?.translation ?? "web"}
      />
      <section
        aria-label="Your pick"
        className="min-h-[7rem] border-t border-[var(--reader-border)] pt-[22px]"
        data-arrival={arrival}
      >
        {bible?.scope !== "bible" && (
          <QueryBoundary fallback={() => null}>
            <ContinueShortcut />
          </QueryBoundary>
        )}
        {chosen && bible?.enabled && bible.scope === "bible" ? (
          <BibleTimePick key={chosen.key} minutes={chosen.minutes} />
        ) : chosen ? (
          <DeskPick
            key={chosen.key}
            minutes={chosen.minutes}
            sessionId={chosen.sessionId}
            onClose={() => setChosen(null)}
            showKeys={showKeys}
          />
        ) : bible?.enabled && bible.scope === "bible" ? (
          <p className="text-[14px] text-[var(--ink-muted)]">
            Choose a time above for a Bible passage.
          </p>
        ) : (
          <QueryBoundary fallback={(retry) => <SlotFailure retry={retry} />}>
            <ImportSlot
              armed={armed}
              upload={pdf.upload}
              problem={pdf.problem}
              onFile={startPdf}
              onClearProblem={pdf.clearProblem}
              onDismiss={pdf.dismiss}
            >
              <DeskRest showKeys={showKeys} />
            </ImportSlot>
          </QueryBoundary>
        )}
      </section>

      {bible?.scope !== "bible" && <PdfDrop onFile={startPdf} />}
    </main>
  );
}

function SlotFailure({ retry }: { retry: () => void }) {
  return (
    <p className="text-[15px] text-[var(--ink-soft)]">
      Couldn't load your desk.{" "}
      <button
        type="button"
        onClick={retry}
        className="underline decoration-[var(--pencil-rule)] underline-offset-[3px] hover:text-[var(--ink)]"
      >
        Retry
      </button>
    </p>
  );
}

export default function DeskRoute() {
  // useSearchParams needs a Suspense boundary for static rendering
  return (
    <Suspense fallback={null}>
      <Desk />
    </Suspense>
  );
}
