"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { InlineError, SavedMark } from "@/components/in-place";
import { OPEN_ARTICLE, ViewTransition } from "@/components/view-transition";
import { FAILURE_COPY, importSteps } from "@/lib/pdf-import";
import { isOnControl, useShortcuts } from "@/lib/shortcuts";
import { articleTitleName, rememberTitle } from "@/lib/title-handoff";
import { invalidateTopicSearchCache } from "@/lib/topic-search-cache";
import type { UploadState } from "@/lib/use-pdf-import";
import { PdfPickerButton } from "./pdf-picker";

const LABEL =
  "text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]";
const PRIMARY =
  "rounded-md bg-[var(--ink)] px-[18px] py-[9px] text-[14.5px] text-[var(--reader-bg)] hover:opacity-90";
const SECONDARY =
  "rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]";
const QUIET =
  "text-[14.5px] text-[var(--ink-soft)] underline decoration-[color-mix(in_srgb,var(--ink)_20%,transparent)] underline-offset-[3px] hover:text-[var(--ink)]";

// How far along the bar sits at each server step; the work has no finer measure
const STEP_PERCENT = { text: 25, sections: 60, point: 90 } as const;

const withoutExtension = (name: string) => name.replace(/\.pdf$/i, "");

function Bar({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Reading in your PDF"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-3 h-[3px] max-w-[560px] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-muted)_30%,transparent)]"
    >
      <span
        className="block h-full rounded-full bg-[var(--ink)] transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function Refusal({
  sentence,
  detail,
  onFile,
  onDismiss,
}: {
  sentence: string;
  detail?: string;
  onFile: (file: File) => void;
  onDismiss: () => void;
}) {
  useShortcuts({ Escape: onDismiss }, true, {
    help: { group: "PDF", keys: [["Esc", "Dismiss"]] },
  });
  return (
    <div className="max-w-[620px]" role="alert">
      <p className={LABEL}>Couldn't read this PDF</p>
      <p className="mt-2 font-serif text-[24px] leading-tight">{sentence}</p>
      {detail && (
        <p className="mt-3 text-[15px] text-[var(--danger)]">{detail}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <PdfPickerButton
          className={SECONDARY}
          onFile={(file) => {
            onDismiss();
            onFile(file);
          }}
        >
          Choose another file
        </PdfPickerButton>
        <button type="button" className={QUIET} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Ready({
  row,
  autoOpen,
  onDismiss,
}: {
  row: Latest;
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
  const ready = Boolean(row.articleId);
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
    ready,
    {
      help: {
        group: "PDF",
        keys: [
          ["Enter  o", "Start reading"],
          ["s", "Save for later"],
          ["Esc", "Dismiss"],
        ],
      },
    },
  );
  const { articleId: readyId, title } = row;
  // The card renders first, so the title morph has its source on screen
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
    row.pages ? `${row.pages.toLocaleString()} pages` : null,
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
      <p className={LABEL}>Ready to read</p>
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
        {isBook && row.firstUnitTitle
          ? `Starts with “${row.firstUnitTitle}”, ${row.firstUnitMinutes} min.`
          : "Marginalia reads alongside you as you go."}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          ref={startRef}
          href={`/read/${articleId}`}
          onClick={onDismiss}
          className={PRIMARY}
        >
          Start reading
        </Link>
        {saved ? (
          <SavedMark visible hold />
        ) : (
          <button
            type="button"
            className={SECONDARY}
            disabled={saving}
            onClick={() => void saveForLater()}
          >
            Save for later
          </button>
        )}
        <button type="button" className={QUIET} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      {failed && (
        <div className="mt-3">
          <InlineError
            message="Couldn't save that PDF."
            onRetry={() => void saveForLater()}
            busy={saving}
          />
        </div>
      )}
    </div>
  );
}

type LatestResult = NonNullable<
  ReturnType<typeof useQuery<typeof api.documentImports.latest>>
>;

type Latest = Omit<LatestResult, "format"> & {
  format?: LatestResult["format"];
};

/**
 * The desk slot for a PDF being brought in: the upload, the server's steps,
 * the moment it is ready, or the plain sentence saying why it was refused.
 * With no import to show it renders `children`, the desk's resting slot.
 */
export function ImportSlot({
  armed,
  ...props
}: Omit<ImportViewProps, "latest" | "autoOpen"> & { armed: boolean }) {
  const latestImport = useQuery(api.documentImports.latest, {});
  const latest = latestImport?.format === "epub" ? null : latestImport;
  // The import that was already there when the file was dropped is not the one
  // to open; `undefined` means no baseline has been taken yet.
  const baseline = useRef<Id<"documentImports"> | null | undefined>(undefined);
  useEffect(() => {
    if (!armed) baseline.current = undefined;
    else if (baseline.current === undefined && latest !== undefined)
      baseline.current = latest?._id ?? null;
  }, [armed, latest]);
  const autoOpen =
    armed &&
    baseline.current !== undefined &&
    latest != null &&
    latest._id !== baseline.current;
  return <ImportView {...props} latest={latest} autoOpen={autoOpen} />;
}

type ImportViewProps = {
  latest: Latest | null | undefined;
  /** Open the import as soon as it is readable, instead of waiting at the Ready card. */
  autoOpen: boolean;
  upload: UploadState | null;
  problem: string | null;
  onFile: (file: File) => void;
  onClearProblem: () => void;
  onDismiss: (importId: Id<"documentImports">) => void;
  children: ReactNode;
};

/** The slot's states, given the latest import; kept apart from the query so each can be shown on its own. */
export function ImportView({
  latest,
  autoOpen,
  upload,
  problem,
  onFile,
  onClearProblem,
  onDismiss,
  children,
}: ImportViewProps) {
  if (upload)
    return (
      <div className="max-w-[620px]" role="status" aria-live="polite">
        <p className={LABEL}>Reading in your PDF</p>
        <h2 className="mt-2 font-serif text-[24px] leading-tight lg:text-[30px]">
          {withoutExtension(upload.fileName)}
        </h2>
        <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">
          {upload.stage === "checking"
            ? "Checking the file…"
            : `Uploading ${upload.percent}%`}
        </p>
        <Bar percent={Math.round(upload.percent * 0.2)} />
      </div>
    );

  if (problem)
    return (
      <Refusal sentence={problem} onFile={onFile} onDismiss={onClearProblem} />
    );

  if (!latest || latest.format === "epub") return <>{children}</>;
  const dismiss = () => onDismiss(latest._id);

  if (latest.status === "failed") {
    const copy = FAILURE_COPY[latest.failure ?? "unreadable"];
    return (
      <Refusal
        sentence={copy.sentence}
        detail={copy.detail}
        onFile={onFile}
        onDismiss={dismiss}
      />
    );
  }
  if (latest.status === "ready")
    return <Ready row={latest} autoOpen={autoOpen} onDismiss={dismiss} />;

  const steps = importSteps(latest);
  return (
    <div className="max-w-[620px]" role="status" aria-live="polite">
      <p className={LABEL}>Reading in your PDF</p>
      <h2 className="mt-2 font-serif text-[24px] leading-tight lg:text-[30px]">
        {withoutExtension(latest.fileName)}
      </h2>
      {latest.pages ? (
        <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">
          {latest.pages.toLocaleString()} pages
        </p>
      ) : null}
      <Bar percent={20 + Math.round(STEP_PERCENT[latest.step] * 0.8)} />
      <ul className="mt-3.5 space-y-1 text-[14px]">
        {steps.done.map((line) => (
          <li key={line} className="text-[var(--ink-muted)]">
            <Check
              size={13}
              aria-hidden
              className="mr-1.5 inline align-[-2px]"
            />
            {line}
          </li>
        ))}
        <li className="text-[var(--pencil)]">{steps.current}</li>
      </ul>
    </div>
  );
}
