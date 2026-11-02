"use client";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { RemoveFeedConfirm } from "./remove-feed-confirm";

/** The subscribed source, with the same article-retention choices as Sources. */
export function ReaderSource({
  feed,
}: {
  feed: { _id: Id<"feeds">; title: string; isActive: boolean };
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmationId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setConfirming(false);
    trigger.current?.focus();
  };

  return (
    <div
      className="mt-2 font-sans text-sm text-[var(--ink-muted)]"
      onKeyDown={(event) => {
        if (confirming && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (event.target === trigger.current) close();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="min-w-0 break-words">
          From{" "}
          <Link
            href="/feeds"
            className="underline underline-offset-4 hover:text-[var(--ink)]"
          >
            {feed.title}
          </Link>
          {!feed.isActive && " (paused)"}
        </span>
        <button
          ref={trigger}
          type="button"
          aria-label={`Unsubscribe from ${feed.title}`}
          aria-expanded={confirming}
          aria-controls={confirming ? confirmationId : undefined}
          onClick={() => setConfirming((open) => !open)}
          className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[var(--ink)]"
        >
          Unsubscribe
        </button>
      </div>
      {confirming && (
        <section
          id={confirmationId}
          aria-label={`Unsubscribe from ${feed.title}`}
          data-reader-overlay=""
          className="text-[var(--reader-fg)]"
        >
          <RemoveFeedConfirm feed={feed} onClose={close} />
        </section>
      )}
    </div>
  );
}
