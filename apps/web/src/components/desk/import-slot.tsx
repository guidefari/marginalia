"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  type DocumentFormat,
  importFailureCopy,
  importSteps,
} from "@/lib/document-import";
import type { UploadState } from "@/lib/document-upload";
import { useShortcuts } from "@/lib/shortcuts";
import { DocumentPickerButton } from "./document-picker";
import { ImportReady } from "./import-ready";

const LABEL =
  "text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]";
const SECONDARY =
  "rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]";
const QUIET =
  "text-[14.5px] text-[var(--ink-soft)] underline decoration-[color-mix(in_srgb,var(--ink)_20%,transparent)] underline-offset-[3px] hover:text-[var(--ink)]";

// How far along the bar sits at each server step; the work has no finer measure
const STEP_PERCENT = { text: 25, sections: 60, point: 90 } as const;

const withoutExtension = (name: string) => name.replace(/\.(pdf|epub)$/i, "");

function Bar({ percent, format }: { percent: number; format: DocumentFormat }) {
  return (
    <div
      role="progressbar"
      aria-label={`Reading in your ${format.toUpperCase()}`}
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
  format,
}: {
  sentence: string;
  detail?: string;
  onFile: (file: File) => void;
  onDismiss: () => void;
  format?: DocumentFormat;
}) {
  useShortcuts({ Escape: onDismiss }, true, {
    help: { group: "Import", keys: [["Esc", "Dismiss"]] },
  });
  return (
    <div className="max-w-[620px]" role="alert">
      <p className={LABEL}>
        Couldn't read this {format?.toUpperCase() ?? "file"}
      </p>
      <p className="mt-2 font-serif text-[24px] leading-tight">{sentence}</p>
      {detail && (
        <p className="mt-3 text-[15px] text-[var(--danger)]">{detail}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <DocumentPickerButton
          className={SECONDARY}
          onFile={(file) => {
            onDismiss();
            onFile(file);
          }}
        >
          Choose another file
        </DocumentPickerButton>
        <button type="button" className={QUIET} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

type LatestResult = NonNullable<
  ReturnType<typeof useQuery<typeof api.documentImports.latest>>
>;

type Latest = Omit<LatestResult, "format"> & {
  format?: LatestResult["format"];
};

export function ImportSlot(props: Omit<ImportViewProps, "latest">) {
  const latest = useQuery(api.documentImports.latest, {});
  return <ImportView {...props} latest={latest} />;
}

type ImportViewProps = {
  latest: Latest | null | undefined;
  armed: boolean;
  targetImportId: Id<"documentImports"> | null;
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
  armed,
  targetImportId,
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
        <p className={LABEL}>Reading in your {upload.format.toUpperCase()}</p>
        <h2 className="mt-2 font-serif text-[24px] leading-tight lg:text-[30px]">
          {withoutExtension(upload.fileName)}
        </h2>
        <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">
          {upload.stage === "checking"
            ? "Checking the file…"
            : `Uploading ${upload.percent}%`}
        </p>
        <Bar
          percent={Math.round(upload.percent * 0.2)}
          format={upload.format}
        />
      </div>
    );

  if (problem)
    return (
      <Refusal sentence={problem} onFile={onFile} onDismiss={onClearProblem} />
    );

  if (!latest) return <>{children}</>;
  const format = latest.format ?? "pdf";
  const dismiss = () => onDismiss(latest._id);

  if (latest.status === "failed") {
    const copy = importFailureCopy(latest.failure ?? "unreadable", format);
    return (
      <Refusal
        sentence={copy.sentence}
        detail={copy.detail}
        format={format}
        onFile={onFile}
        onDismiss={dismiss}
      />
    );
  }
  if (latest.status === "ready")
    return (
      <ImportReady
        key={latest._id}
        row={latest}
        autoOpen={armed && latest._id === targetImportId}
        onDismiss={dismiss}
      />
    );

  const steps = importSteps(latest);
  return (
    <div className="max-w-[620px]" role="status" aria-live="polite">
      <p className={LABEL}>Reading in your {format.toUpperCase()}</p>
      <h2 className="mt-2 font-serif text-[24px] leading-tight lg:text-[30px]">
        {withoutExtension(latest.fileName)}
      </h2>
      {format === "pdf" && latest.pages ? (
        <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">
          {latest.pages.toLocaleString()} pages
        </p>
      ) : null}
      <Bar
        percent={20 + Math.round(STEP_PERCENT[latest.step] * 0.8)}
        format={format}
      />
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
