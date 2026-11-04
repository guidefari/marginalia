"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InlineError, SavedMark } from "@/components/in-place";
import { OPEN_ARTICLE, ViewTransition } from "@/components/view-transition";
import type { DocumentFormat } from "@/lib/document-import";
import { isOnControl, useShortcuts } from "@/lib/shortcuts";
import { articleTitleName, rememberTitle } from "@/lib/title-handoff";
import { invalidateTopicSearchCache } from "@/lib/topic-search-cache";

type ReadyRow = {
  articleId?: Id<"articles">;
  title?: string;
  format?: DocumentFormat;
  pages?: number;
  units?: number;
  minutes?: number;
  firstUnitTitle?: string;
  firstUnitMinutes?: number;
};

export function ImportReady({
  row,
  autoOpen,
  onDismiss,
}: {
  row: ReadyRow;
  autoOpen: boolean;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const opened = useRef(false);
  const save = useMutation(api.savedArticles.save);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const startRef = useRef<HTMLAnchorElement>(null);
  useShortcuts(
    {
      Enter: (event) => {
        if (isOnControl(event)) return false;
        startRef.current?.click();
      },
      o: () => startRef.current?.click(),
      s: () => (saved || saving ? false : void saveForLater()),
      Escape: onDismiss,
    },
    Boolean(row.articleId),
    {
      help: {
        group: "Import",
        keys: [
          ["Enter  o", "Start reading"],
          ["s", "Save for later"],
          ["Esc", "Dismiss"],
        ],
      },
    },
  );
  const { articleId: readyId, title } = row;
  useEffect(() => {
    if (!autoOpen || !readyId || opened.current) return;
    opened.current = true;
    rememberTitle(readyId, title ?? "");
    onDismiss();
    router.push(`/read/${readyId}`, { transitionTypes: [OPEN_ARTICLE] });
  }, [autoOpen, readyId, title, onDismiss, router]);
  if (!row.articleId) return null;
  const articleId = row.articleId;
  const isBook = row.units !== undefined;
  const partMinutes =
    isBook && row.minutes && row.units
      ? Math.max(1, Math.round(row.minutes / row.units))
      : null;
  const meta = [
    row.format !== "epub" && row.pages
      ? `${row.pages.toLocaleString()} pages`
      : null,
    isBook
      ? `${row.units?.toLocaleString()} parts${partMinutes ? ` of about ${partMinutes} min` : ""}`
      : row.minutes
        ? `${row.minutes} min`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
  async function saveForLater() {
    setSaving(true);
    setFailed(false);
    try {
      await save({ articleId });
      invalidateTopicSearchCache();
      setSaved(true);
    } catch {
      setFailed(true);
    }
    setSaving(false);
  }
  return (
    <div className="max-w-[620px]">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        Ready to read
      </p>
      <ViewTransition
        name={articleTitleName(articleId)}
        share="article-title"
        default="none"
      >
        <h2 className="mt-2 font-serif text-[24px] leading-tight lg:text-[30px]">
          {row.title}
        </h2>
      </ViewTransition>
      <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">{meta}</p>
      <p className="mt-3 text-[15px] text-[var(--pencil)]">
        {isBook && row.firstUnitTitle && row.firstUnitMinutes !== undefined
          ? `Starts with “${row.firstUnitTitle}”, ${row.firstUnitMinutes} min.`
          : "Marginalia reads alongside you as you go."}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          ref={startRef}
          href={`/read/${articleId}`}
          onClick={onDismiss}
          className="rounded-md bg-[var(--ink)] px-[18px] py-[9px] text-[14.5px] text-[var(--reader-bg)] hover:opacity-90"
        >
          Start reading
        </Link>
        {saved ? (
          <SavedMark visible hold />
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveForLater()}
            className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
          >
            Save for later
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="text-[14.5px] text-[var(--ink-soft)] underline decoration-[color-mix(in_srgb,var(--ink)_20%,transparent)] underline-offset-[3px] hover:text-[var(--ink)]"
        >
          Dismiss
        </button>
      </div>
      {failed && (
        <div className="mt-3">
          <InlineError
            message={`Couldn't save that ${(row.format ?? "pdf").toUpperCase()}.`}
            onRetry={() => void saveForLater()}
            busy={saving}
          />
        </div>
      )}
    </div>
  );
}
