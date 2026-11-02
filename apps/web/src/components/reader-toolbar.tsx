"use client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  useCompactTitle,
  useHeadingScrolledAway,
} from "@/lib/use-compact-title";
import { cn } from "@/lib/utils";
import { RATINGS } from "./impression-panel";
import { InlineError } from "./in-place";
import { Keycap } from "./keycap";
import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelProps,
} from "./reader-settings-panel";
import {
  FINISH_ARTICLE,
  OPEN_ARTICLE,
  ViewTransition,
} from "./view-transition";

const ICON = { size: 18, strokeWidth: 1.5 } as const;
const BUTTON =
  "inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--reader-chip)] data-[state=open]:bg-[var(--reader-chip)] data-[state=open]:text-[var(--ink)] transition-colors";
const MENU_ITEM =
  "flex min-h-11 sm:min-h-9 cursor-default items-center justify-between gap-6 rounded-md px-2.5 py-2 font-sans text-sm text-[var(--ink)] outline-none data-[highlighted]:bg-[var(--reader-chip)]";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="hidden sm:inline font-mono text-[11px] text-[var(--ink-muted)]">
      {children}
    </kbd>
  );
}

export interface ReaderToolbarProps {
  tools?: ReactNode;
  pageGoal?: ReactNode;
  title: string;
  /** The article's own heading. Once it scrolls away, the bar shows `title` in its middle slot. */
  headingElement: HTMLElement | null;
  /** Absent for a PDF the reader uploaded, which has no page to open. */
  originalUrl?: string;
  /** Where Back returns to, and the room it names (Desk, Library or Notes). */
  backHref: string;
  backLabel: string;
  /** Widest the toolbar may run, matched to the article column. */
  maxWidth: string;
  noteCount: number;
  noteCountHasMore?: boolean;
  onToggleNotes: () => void;
  rating: number | undefined;
  /** Scrolls to the impression in the back matter (★ and `r`). */
  onRate: () => void;
  loved: boolean;
  onToggleLove: () => void;
  listening: boolean;
  onToggleListen: () => void;
  onToggleSummary: () => void;
  /** Only an article that was finished can be marked unread. */
  onMarkUnread: (() => void) | null;
  /** Absent for a book, whose margin is written a part at a time. */
  onReannotate: (() => void) | null;
  settings: Omit<ReaderSettingsPanelProps, "onOpenChange">;
}

/** The reader's top bar: Back, the title once the heading scrolls away, Aa, rate, love and an overflow menu. Notes lives in the menu. */
export function ReaderToolbar({
  title,
  headingElement,
  originalUrl,
  backHref,
  backLabel,
  maxWidth,
  noteCount,
  noteCountHasMore = false,
  onToggleNotes,
  rating,
  onRate,
  loved,
  onToggleLove,
  listening,
  onToggleListen,
  onToggleSummary,
  onMarkUnread,
  onReannotate,
  settings,
  tools,
  pageGoal,
}: ReaderToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const headingAway = useHeadingScrolledAway(headingElement);
  const compactTitle = useCompactTitle(title, headingAway);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}`,
      );
      setCopyFailed(false);
      toast.success("Link copied");
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <ViewTransition
      name="reader-toolbar"
      default="none"
      enter={{ [OPEN_ARTICLE]: "reader-toolbar", default: "none" }}
      exit={{ [FINISH_ARTICLE]: "reader-toolbar", default: "none" }}
    >
      <div
        data-testid="reader-toolbar"
        className="reader-toolbar fixed top-0 left-0 right-[var(--notes-inset)] transition-[right] duration-200 pt-[env(safe-area-inset-top)] z-40 bg-[color-mix(in_srgb,var(--reader-bg)_82%,transparent)] backdrop-blur-sm"
      >
        <div
          className="mx-auto px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between"
          style={{ maxWidth }}
        >
          <Link
            href={backHref}
            scroll={false}
            className="flex min-h-11 sm:min-h-0 items-center gap-1.5 font-sans text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors"
            aria-label={`Back to ${backLabel}`}
          >
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>

          <span className="flex-1 min-w-0 px-3">
            <span
              data-testid="reader-toolbar-title"
              data-shown={headingAway}
              aria-hidden="true"
              className="reader-toolbar-title block min-w-0 truncate font-sans text-sm text-[var(--ink-soft)]"
            >
              {compactTitle}
            </span>
            {pageGoal}
          </span>

          <div className="flex items-center gap-0.5">
            {tools}
            <span className="relative">
              <ReaderSettingsPanel {...settings} />
              <Keycap className="absolute -bottom-1.5 left-1/2 -translate-x-1/2">
                ,
              </Keycap>
            </span>

            <DropdownMenu.Root
              modal={false}
              open={menuOpen}
              onOpenChange={setMenuOpen}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={BUTTON}
                  aria-label="More actions"
                  title="More actions"
                >
                  <MoreHorizontal {...ICON} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  aria-label="More actions"
                  className="reader-menu z-50 w-60 p-1.5 outline-none"
                >
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleNotes}
                    aria-keyshortcuts="n"
                    title="Notes (n)"
                  >
                    Notes
                    {noteCount > 0 || noteCountHasMore
                      ? ` · ${noteCount}${noteCountHasMore ? "+" : ""}`
                      : ""}
                    <Kbd>n</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleSummary}
                    aria-keyshortcuts="u"
                  >
                    Summary
                    <Kbd>u</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleListen}
                    aria-keyshortcuts="l"
                  >
                    {listening ? "Stop listening" : "Listen"}
                    <Kbd>l</Kbd>
                  </DropdownMenu.Item>
                  {/* The impression at the end is the main place to rate; these two only point there. */}
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onRate}
                    aria-keyshortcuts="r"
                    title={
                      rating
                        ? `You rated this ${RATINGS[rating - 1]} (r)`
                        : "Rate this article (r)"
                    }
                  >
                    {rating
                      ? `Rated ${RATINGS[rating - 1]}`
                      : "Rate this article"}
                    <Kbd>r</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleLove}
                    aria-keyshortcuts="v"
                    title={
                      loved ? "Remove from loved (v)" : "Love this article (v)"
                    }
                  >
                    {loved ? "Remove from loved" : "Love this article"}
                    <Kbd>v</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 mx-1.5 h-px bg-[var(--reader-border)]" />
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={copyLink}>
                    Copy link
                  </DropdownMenu.Item>
                  {originalUrl && (
                    <DropdownMenu.Item className={MENU_ITEM} asChild>
                      <a href={originalUrl} target="_blank" rel="noreferrer">
                        Open original
                      </a>
                    </DropdownMenu.Item>
                  )}
                  {onMarkUnread && (
                    <DropdownMenu.Item
                      className={MENU_ITEM}
                      onSelect={onMarkUnread}
                    >
                      Mark unread
                    </DropdownMenu.Item>
                  )}
                  {onReannotate && (
                    <>
                      <DropdownMenu.Separator className="my-1 mx-1.5 h-px bg-[var(--reader-border)]" />
                      <DropdownMenu.Item
                        className={cn(MENU_ITEM, "text-[var(--ink-soft)]")}
                        onSelect={onReannotate}
                      >
                        Re-annotate with latest vault
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
        {copyFailed && (
          <div className="absolute top-full right-3 left-3 mt-1 rounded-md bg-[var(--reader-surface)] p-3 font-sans ring-1 ring-[var(--reader-border)] sm:left-auto sm:right-6 sm:max-w-sm">
            <InlineError
              message="Couldn't copy the link."
              onRetry={() => void copyLink()}
            />
          </div>
        )}
      </div>
    </ViewTransition>
  );
}
