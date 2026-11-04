"use client";
import {
  type BibleSuggestion,
  estimatePassageMinutes,
  parseBibleSearchReference,
  type ReadingScope,
} from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { Link2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DocumentPickerButton } from "@/components/desk/document-picker";
import {
  FinderNotes,
  noteHitLink,
  noteOptionId,
  useNoteHits,
} from "@/components/finder-notes";
import { InlineError, Skeleton, SkeletonBar } from "@/components/in-place";
import { FAILURE_COPY, failureSentence } from "@/lib/failure-copy";
import { consumeFinderRequest } from "@/lib/finder-request";
import {
  isOnControl,
  isTypingTarget,
  useCommand,
  useShortcuts,
} from "@/lib/shortcuts";
import { type TopicMatch, topicCard } from "@/lib/topic-card";
import { invalidateTopicSearchCache } from "@/lib/topic-search-cache";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { usePresented } from "@/lib/use-presented";
import { useTopicSearch } from "@/lib/use-topic-search";

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;

const labelClass =
  "mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]";
const primaryClass =
  "rounded-md bg-[var(--reader-fg)] px-4 py-2 text-[14px] text-[var(--reader-surface)] disabled:opacity-60";
const secondaryClass =
  "rounded-md bg-[var(--reader-chip)] px-4 py-2 text-[14px] text-[var(--reader-fg-soft)]";
const quietClass =
  "py-2 text-[14px] text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] disabled:no-underline";

type FinderCandidate =
  | { kind: "article"; match: TopicMatch }
  | { kind: "bible"; passage: BibleSuggestion };

function articleCandidates(matches: TopicMatch[], limit: number | null) {
  const candidates: FinderCandidate[] = [];
  let position = 0;
  while (position < matches.length) {
    const card = topicCard(matches, position, limit);
    if (card.kind !== "card") break;
    candidates.push({ kind: "article", match: card.match });
    position = card.index + 1;
  }
  return candidates;
}

function interleaveCandidates(
  articles: FinderCandidate[],
  bible: FinderCandidate[],
  scope: ReadingScope,
) {
  if (scope === "articles") return articles;
  if (scope === "bible") return bible;
  const mixed: FinderCandidate[] = [];
  for (
    let index = 0;
    index < Math.max(articles.length, bible.length);
    index++
  ) {
    if (articles[index]) mixed.push(articles[index]);
    if (bible[index]) mixed.push(bible[index]);
  }
  return mixed;
}

function metaLine(match: TopicMatch) {
  return [
    match.source ?? match.author,
    match.minutes ? `${match.minutes} min` : null,
    match.status === "Finished" ? "read before" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The floating picker: type a topic and get one article at a time, or paste a
 * link. `windowMinutes` is the time the desk has chosen, if any; matches then
 * have to fit it until the reader clears the limit.
 */
export function ArticleFinder({
  windowMinutes = null,
  onClearWindow,
  onDocument,
  onType,
  showKey = false,
  scope = "articles",
  translation = "web",
}: {
  windowMinutes?: number | null;
  onClearWindow?: () => void;
  onDocument?: (file: File) => void;
  /** Called when the reader types in the bar. */
  onType?: () => void;
  /** The desk's hold-Alt overlay: show the `/` key on the trigger. */
  showKey?: boolean;
  scope?: ReadingScope;
  translation?: string;
}) {
  const router = useRouter();
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const suggestBible = useAction(api.actions.bible.suggest);
  const openPassage = useAction(api.actions.bible.openReading);
  const saveArticle = useMutation(api.savedArticles.save);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(0);
  // The note the arrow keys are on, after the last article card; null is the card
  const [noteIndex, setNoteIndex] = useState<number | null>(null);
  const [limitCleared, setLimitCleared] = useState(false);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [saveFailed, setSaveFailed] = useState<{
    articleId: string;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // A pasted link that failed to add, kept under that link with Retry
  const [linkFailed, setLinkFailed] = useState<{
    url: string;
    andRead: boolean;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [bibleRetry, setBibleRetry] = useState(0);
  const [bibleResult, setBibleResult] = useState<{
    key: string;
    retry: number;
    passages: BibleSuggestion[];
    notice: string | null;
  } | null>(null);
  const [bibleError, setBibleError] = useState<{
    key: string;
    retry: number;
    message: string;
  } | null>(null);
  const [openingPassage, setOpeningPassage] = useState<string | null>(null);
  const passageRequests = useRef(new Set<string>());
  const latestPassageRequest = useRef<object | null>(null);
  const intentRef = useRef<string | null>(null);
  const openEpoch = useRef(0);
  const closeFinder = () => {
    openEpoch.current++;
    intentRef.current = null;
    setOpen(false);
  };
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const text = query.trim();
  const queryRef = useRef(text);
  const scopeRef = useRef(scope);
  const isLink = URL_PATTERN.test(text);
  const directReference =
    scope !== "articles" && !isLink ? parseBibleSearchReference(text) : null;
  const limit = limitCleared ? null : windowMinutes;
  const submissionKey = (
    query: string,
    source: ReadingScope,
    minutes: number | null,
  ) => `${source}\u0000${query}\u0000${minutes ?? "all"}`;
  const activeKey =
    open && text.length >= 2 && !isLink
      ? submissionKey(text, scope, limit)
      : null;
  useLayoutEffect(() => {
    queryRef.current = text;
    scopeRef.current = scope;
    intentRef.current = open ? activeKey : null;
  }, [text, scope, open, activeKey]);
  const searching =
    open &&
    text.length >= 2 &&
    !isLink &&
    scope !== "bible" &&
    !directReference;
  const result = useTopicSearch(text, searching, retry);
  const noteHits = useNoteHits(text, searching);
  const bibleKey = activeKey ?? "";
  const bibleSearching =
    open &&
    scope !== "articles" &&
    text.length >= 2 &&
    !isLink &&
    !directReference;
  const visibleBible =
    open && directReference
      ? {
          key: bibleKey,
          retry: bibleRetry,
          passages: [
            {
              reference: directReference.reference,
              title: directReference.reference,
              minutes: estimatePassageMinutes(directReference),
              reason:
                "Recognized passage reference. Open this passage directly.",
            },
          ],
          notice: null,
        }
      : bibleSearching &&
          bibleResult?.key === bibleKey &&
          bibleResult.retry === bibleRetry
        ? bibleResult
        : null;
  useEffect(() => {
    if (!bibleSearching) return;
    let current = true;
    let requestTimeout: number | undefined;
    setBibleError(null);
    setBibleResult(null);
    const debounce = window.setTimeout(() => {
      requestTimeout = window.setTimeout(() => {
        current = false;
        setBibleError({
          key: bibleKey,
          retry: bibleRetry,
          message: "Bible search couldn't complete. Try again.",
        });
      }, 30_000);
      void suggestBible({ question: text, minutes: limit ?? undefined }).then(
        (value) => {
          if (current)
            setBibleResult({ key: bibleKey, retry: bibleRetry, ...value });
          clearTimeout(requestTimeout);
        },
        () => {
          if (current)
            setBibleError({
              key: bibleKey,
              retry: bibleRetry,
              message: "Bible search couldn't complete. Try again.",
            });
          clearTimeout(requestTimeout);
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(debounce);
      clearTimeout(requestTimeout);
    };
  }, [bibleSearching, bibleKey, suggestBible, text, limit, bibleRetry]);
  const noteSelected = noteIndex !== null ? noteHits[noteIndex] : undefined;
  useShortcuts({ "/": () => setOpen(true) }, true, {
    help: {
      group: "Desk",
      keys: [["/", "Search, paste a link or choose a PDF or EPUB"]],
    },
  });
  useCommand("open-finder", () => {
    consumeFinderRequest();
    setOpen(true);
  });
  // Search from another room lands on the desk with ?find=1; open the picker once
  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = consumeFinderRequest();
    if (!requested && url.searchParams.get("find") !== "1") return;
    url.searchParams.delete("find");
    window.history.replaceState(window.history.state, "", url);
    setOpen(true);
  }, []);

  useModalDialog(dialogRef, open, triggerRef);

  // The desk can choose a different time while the picker is closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new window or a reopened picker restores the limit
  useEffect(() => {
    setLimitCleared(false);
  }, [open, windowMinutes]);

  const current = result.query === text;
  const bibleLoading = bibleSearching && !visibleBible && !bibleError;
  const loading =
    (searching && (!current || result.status === "loading")) || bibleLoading;
  const articleDeck =
    searching && current && result.status === "ready"
      ? articleCandidates(result.matches, limit)
      : [];
  const bibleDeck =
    (directReference || bibleSearching) && visibleBible
      ? visibleBible.passages
          .filter(
            (passage) =>
              directReference || limit === null || passage.minutes <= limit,
          )
          .map((passage): FinderCandidate => ({ kind: "bible", passage }))
      : [];
  const candidates = interleaveCandidates(articleDeck, bibleDeck, scope);
  const candidate = candidates[position];
  const shown = candidate?.kind === "article" ? candidate.match : null;
  const shownBible = candidate?.kind === "bible" ? candidate.passage : null;
  const articleCard =
    searching && current && result.status === "ready"
      ? topicCard(result.matches, 0, limit)
      : null;
  const recordInteraction = useMutation(api.sessions.recordInteraction);
  // SAFETY: match ids come from the library search, which returns article ids.
  usePresented(
    shown?.articleId as Id<"articles"> | undefined,
    (articleId) => {
      recordInteraction({
        articleId,
        action: "presented",
      }).catch((error) => console.error("Couldn't record the offer", error));
    },
    open,
  );
  const shortest =
    articleCard?.kind === "none-fit" ? articleCard.shortest : null;

  const go = (articleId: string) => {
    closeFinder();
    router.push(`/read/${articleId}`);
  };
  // Arrow keys step through the cards, then on into the notes.
  const down = () => {
    if (noteIndex !== null) {
      setNoteIndex(Math.min(noteIndex + 1, noteHits.length - 1));
    } else if (position < candidates.length - 1) another();
    else if (noteHits.length) setNoteIndex(0);
  };
  const up = () => {
    if (noteIndex !== null) {
      setNoteIndex(noteIndex === 0 ? null : noteIndex - 1);
    } else previous();
  };
  const clearLimit = () => {
    setLimitCleared(true);
    onClearWindow?.();
  };
  const another = () => {
    if (position < candidates.length - 1) setPosition(position + 1);
  };
  const previous = () => {
    if (position > 0) setPosition(position - 1);
  };
  const save = async (articleId: string) => {
    try {
      await saveArticle({ articleId: articleId as Id<"articles"> });
      invalidateTopicSearchCache();
      setSaved((ids) => new Set(ids).add(articleId));
      setSaveFailed(null);
    } catch (error) {
      setSaveFailed({
        articleId,
        message: failureSentence(error, FAILURE_COPY.save),
      });
    }
  };
  const fromLink = async (andRead: boolean) => {
    if (busy) return;
    setBusy(true);
    setLinkFailed(null);
    const requestedText = text;
    const requestedScope = scope;
    const url = requestedText.startsWith("www.")
      ? `https://${requestedText}`
      : requestedText;
    try {
      const { articleId, alreadyExists } = await addByUrl({ url });
      invalidateTopicSearchCache();
      if (andRead) {
        toast.success(
          alreadyExists
            ? "Already in your library. Opening it."
            : "Added. Marginalia is on its way.",
        );
        if (
          queryRef.current === requestedText &&
          scopeRef.current === requestedScope
        )
          go(articleId);
      } else {
        await save(articleId);
        if (
          queryRef.current === requestedText &&
          scopeRef.current === requestedScope
        )
          setQuery("");
      }
    } catch (error) {
      setLinkFailed({
        url: text,
        andRead,
        message: failureSentence(error, FAILURE_COPY.unreachable),
      });
    } finally {
      setBusy(false);
    }
  };
  const readNow = () => {
    if (isLink) void fromLink(true);
    else if (noteSelected) {
      closeFinder();
      router.push(noteHitLink(noteSelected));
    } else if (shown) go(shown.articleId);
    else if (shownBible && activeKey) {
      if (passageRequests.current.has(shownBible.reference)) return;
      passageRequests.current.add(shownBible.reference);
      const request = {};
      latestPassageRequest.current = request;
      const intent = activeKey;
      const epoch = openEpoch.current;
      setOpeningPassage(shownBible.reference);
      setBibleError(null);
      void openPassage({ reference: shownBible.reference })
        .then((id) => {
          if (
            intentRef.current !== intent ||
            openEpoch.current !== epoch ||
            latestPassageRequest.current !== request
          )
            return;
          closeFinder();
          router.push(`/read/${id}`);
        })
        .catch(() => {
          if (
            intentRef.current === intent &&
            openEpoch.current === epoch &&
            latestPassageRequest.current === request
          )
            setBibleError({
              key: intent,
              retry: bibleRetry,
              message: "Couldn't open this passage. Try again.",
            });
        })
        .finally(() => {
          passageRequests.current.delete(shownBible.reference);
          if (latestPassageRequest.current === request) {
            latestPassageRequest.current = null;
            setOpeningPassage(null);
          }
        });
    }
  };

  const reason = shown && result.reasons[shown.articleId];
  const savedShown = shown ? saved.has(shown.articleId) : false;

  // Arrows work while typing; the letters and a bare Enter only when the
  // input isn't focused, so they never type over the query.
  const onDialogKey = (e: React.KeyboardEvent) => {
    const native = e.nativeEvent;
    if (native.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = isTypingTarget(e.target);
    if (e.key === "ArrowDown" || (!typing && e.key === "j")) down();
    else if (e.key === "ArrowUp" || (!typing && e.key === "k")) up();
    else if (!typing && e.key === "s") {
      if (isLink) void fromLink(false);
      else if (shown && !savedShown && !noteSelected)
        void save(shown.articleId);
      else return;
    } else if (!typing && e.key === "Enter" && !isOnControl(native)) readNow();
    else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="/"
        title="Ask, paste a link, or drop a PDF or EPUB · press /"
        className="flex w-full items-center gap-2.5 h-12 rounded-lg px-4 bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] text-left text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-colors"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[15px]">
          Ask, paste a link, or drop a PDF or EPUB
        </span>
        {showKey && (
          <kbd className="reader-kbd hidden md:inline-block" aria-hidden>
            /
          </kbd>
        )}
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Find something to read"
        onCancel={(e) => {
          e.preventDefault();
          closeFinder();
        }}
        onClose={closeFinder}
        onKeyDown={onDialogKey}
        className="mx-auto mt-[calc(var(--app-viewport-top)+env(safe-area-inset-top)+1rem)] md:mt-[12dvh] mb-auto w-[calc(100%-2rem)] max-w-[640px] max-h-[calc(var(--app-viewport-height)-env(safe-area-inset-top)-2rem)] rounded-[10px] p-0 overflow-hidden bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border-strong)] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.6)] backdrop:bg-black/40 font-sans"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLink) {
              void fromLink(true);
              return;
            }
            readNow();
          }}
          className="focus-frame grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3.5 border-b border-[var(--reader-border)] md:flex"
        >
          {isLink ? (
            <Link2 size={19} className="shrink-0 text-[var(--reader-muted)]" />
          ) : (
            <Search size={19} className="shrink-0 text-[var(--reader-muted)]" />
          )}
          <input
            type="text"
            aria-label="Ask for something to read, or paste a link"
            maxLength={2000}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPosition(0);
              setNoteIndex(null);
              onType?.();
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={Boolean(candidate) || noteHits.length > 0}
            aria-controls={noteSelected ? `${id}-notes` : `${id}-results`}
            aria-activedescendant={
              noteSelected
                ? noteOptionId(id, noteIndex ?? 0)
                : candidate
                  ? `${id}-option-${candidate.kind === "article" ? candidate.match.articleId : encodeURIComponent(candidate.passage.reference)}`
                  : undefined
            }
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing && e.key === "Enter") {
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                readNow();
              }
            }}
            placeholder="Science, a quick read, that piece about cows…"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--reader-muted)]"
          />
          <span
            aria-hidden
            className="reader-kbd hidden shrink-0 md:inline-block"
          >
            esc
          </span>
          <button
            type="button"
            onClick={closeFinder}
            aria-label="Close search"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--reader-fg)] md:hidden"
          >
            <X size={16} />
          </button>
        </form>
        <div className="max-h-[min(calc(var(--app-viewport-height)-10rem),480px)] overflow-y-auto overscroll-contain">
          {!text && (
            <div className="px-5 py-6 text-[14px] text-[var(--reader-muted)]">
              <p>Search Articles, Bible, or both. You can also paste a link.</p>
              {onDocument && (
                <p className="mt-3">
                  Or{" "}
                  <DocumentPickerButton
                    className="text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)]"
                    onFile={(file) => {
                      closeFinder();
                      onDocument(file);
                    }}
                  >
                    choose a PDF or EPUB
                  </DocumentPickerButton>{" "}
                  to read.
                </p>
              )}
              <p className="mt-3">
                <Link
                  href="/bible"
                  className="text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px]"
                >
                  Browse all available Bibles
                </Link>
              </p>
            </div>
          )}
          {text && text.length < 2 && !isLink && (
            <p className="px-5 py-6 text-[14px] text-[var(--reader-muted)]">
              Keep typing.
            </p>
          )}
          {visibleBible &&
            visibleBible.passages.length > 0 &&
            candidates.length === 0 && (
              <p role="status" className="px-5 py-6 text-sm">
                No passages fit this time. Clear the time or choose a longer
                window.
              </p>
            )}
          {bibleError?.key === bibleKey &&
            bibleError.retry === bibleRetry &&
            (directReference || bibleSearching) && (
              <p role="alert" className="px-5 py-4 text-sm">
                {bibleError.message}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    if (directReference) readNow();
                    else setBibleRetry((value) => value + 1);
                  }}
                >
                  Retry
                </button>
              </p>
            )}
          {isLink && (
            <div className="px-[18px] pb-4 pt-[18px]">
              <p className={labelClass}>A link</p>
              <p className="mb-1.5 break-all font-serif text-[22px] leading-tight">
                {text}
              </p>
              <p className="mb-4 text-[14.5px] text-[var(--pencil)]">
                {busy ? "Fetching article…" : "Not in your library yet."}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  className={primaryClass}
                  disabled={busy}
                  onClick={() => void fromLink(true)}
                >
                  Save and read
                </button>
                <button
                  type="button"
                  className={quietClass}
                  disabled={busy}
                  onClick={() => void fromLink(false)}
                >
                  Save for later
                </button>
              </div>
              {linkFailed?.url === text && (
                <div className="mt-3">
                  <InlineError
                    message={linkFailed.message}
                    busy={busy}
                    onRetry={() => void fromLink(linkFailed.andRead)}
                  />
                </div>
              )}
            </div>
          )}
          {loading && (
            <Skeleton label="Finding something that fits" className="px-5 py-6">
              <SkeletonBar className="h-6 w-[70%]" />
              <SkeletonBar className="mt-3 h-3.5 w-[30%]" />
            </Skeleton>
          )}
          {candidate && (
            <div className="px-[18px] pb-4 pt-[18px]">
              <div
                id={`${id}-results`}
                role="listbox"
                aria-label={`Results about ${text}`}
              >
                <div
                  id={`${id}-option-${candidate.kind === "article" ? candidate.match.articleId : encodeURIComponent(candidate.passage.reference)}`}
                  role="option"
                  aria-selected={!noteSelected}
                >
                  <p className={labelClass}>
                    {candidate.kind === "article" ? "Article" : "Bible"} · About{" "}
                    {text}
                  </p>
                  <h3
                    key={
                      candidate.kind === "article"
                        ? candidate.match.articleId
                        : candidate.passage.reference
                    }
                    className="mb-1.5 font-serif text-[22px] leading-tight md:text-[26px]"
                  >
                    {candidate.kind === "article"
                      ? candidate.match.title
                      : candidate.passage.reference}
                  </h3>
                  <p className="mb-2 text-[13.5px] text-[var(--reader-muted)]">
                    {candidate.kind === "article"
                      ? metaLine(candidate.match)
                      : `${translation.toUpperCase()} · ~${candidate.passage.minutes} min`}
                  </p>
                  <p className="mb-4 min-h-[22px] text-[14.5px] text-[var(--pencil)]">
                    {(candidate.kind === "article"
                      ? reason
                      : candidate.passage.reason) ||
                      (candidate.kind === "article" && !result.explained && (
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-[180px] animate-pulse rounded-full bg-[var(--reader-chip)] align-middle"
                        />
                      ))}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  className={primaryClass}
                  aria-keyshortcuts="Enter"
                  disabled={
                    candidate.kind === "bible" &&
                    openingPassage === candidate.passage.reference
                  }
                  onClick={readNow}
                >
                  {candidate.kind === "bible" &&
                  openingPassage === candidate.passage.reference
                    ? "Opening passage…"
                    : "Read now"}
                </button>
                {position < candidates.length - 1 && (
                  <button
                    type="button"
                    className={secondaryClass}
                    aria-keyshortcuts="ArrowDown"
                    onClick={another}
                  >
                    Another
                  </button>
                )}
                <button
                  type="button"
                  className={quietClass}
                  hidden={!shown}
                  disabled={savedShown}
                  aria-keyshortcuts="s"
                  onClick={() => shown && void save(shown.articleId)}
                >
                  {shown && saved.has(shown.articleId)
                    ? "Saved"
                    : "Save for later"}
                </button>
                <span className="ml-auto hidden text-[12.5px] text-[var(--reader-muted)] md:inline">
                  {position + 1} of {candidates.length}
                  {scope !== "bible" && result.more ? "+" : ""}
                </span>
                {position > 0 && (
                  <button
                    type="button"
                    className={quietClass}
                    aria-keyshortcuts="ArrowUp"
                    onClick={previous}
                  >
                    Previous
                  </button>
                )}
              </div>
              {shown && saveFailed?.articleId === shown.articleId && (
                <div className="mt-3">
                  <InlineError
                    message={saveFailed.message}
                    onRetry={() => void save(shown.articleId)}
                  />
                </div>
              )}
            </div>
          )}
          {!candidate &&
            articleCard?.kind === "none-fit" &&
            scope !== "bible" && (
              <div className="px-[18px] pb-4 pt-[18px]">
                <p className={labelClass}>
                  About {text}, within {limit} min
                </p>
                <p className="mb-1.5 font-serif text-[22px] leading-tight">
                  Nothing on {text} fits in {limit} minutes.
                </p>
                {shortest && (
                  <p className="mb-4 text-[14.5px] text-[var(--pencil)]">
                    The shortest is {shortest.minutes} min: &ldquo;
                    {shortest.title}&rdquo;.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2.5">
                  {shortest && (
                    <button
                      type="button"
                      className={secondaryClass}
                      onClick={() => go(shortest.articleId)}
                    >
                      Read it anyway
                    </button>
                  )}
                  <button
                    type="button"
                    className={quietClass}
                    onClick={clearLimit}
                  >
                    Clear the time
                  </button>
                </div>
              </div>
            )}
          {!candidate && articleCard?.kind === "end" && (
            <div className="px-[18px] py-5">
              <p className="mb-3 text-[14px] text-[var(--reader-fg-soft)]">
                That&apos;s everything closest to {text}.
              </p>
              <button
                type="button"
                className={secondaryClass}
                onClick={() => setPosition(0)}
              >
                Start again
              </button>
            </div>
          )}
          {!candidate &&
            articleCard?.kind === "empty" &&
            scope === "articles" && (
              <p
                role="status"
                className="px-5 py-6 text-[14px] text-[var(--reader-muted)]"
              >
                Nothing in your library fits that yet. Try another topic or
                paste a link.
              </p>
            )}
          {!candidate &&
            scope !== "articles" &&
            visibleBible?.passages.length === 0 &&
            (!searching || articleCard?.kind === "empty") && (
              <p
                role="status"
                className="px-5 py-6 text-[14px] text-[var(--reader-muted)]"
              >
                {scope === "mixed"
                  ? "Nothing in your library or Bible fits that topic yet."
                  : "No passages fit that topic. Try another topic or a longer window."}
              </p>
            )}
          {searching && (
            <FinderNotes
              hits={noteHits}
              selected={noteIndex}
              idPrefix={id}
              labelClass={labelClass}
              onOpen={closeFinder}
            />
          )}
          {searching && current && result.status === "error" && (
            <div
              role="alert"
              className="px-5 py-6 text-[14px] text-[var(--reader-fg-soft)]"
            >
              {result.error ? (
                <>
                  {result.error}{" "}
                  <Link
                    href="/account"
                    onClick={closeFinder}
                    className="underline underline-offset-2"
                  >
                    Open Your account
                  </Link>
                </>
              ) : (
                <>
                  Couldn&apos;t search your library.{" "}
                  <button
                    type="button"
                    onClick={() => setRetry((n) => n + 1)}
                    className="underline underline-offset-2"
                  >
                    Try again
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {searching && (
          <div className="border-t border-[var(--reader-border)] px-[18px] py-2.5 text-[12.5px] text-[var(--reader-muted)]">
            See every match in{" "}
            <Link
              href={`/library?q=${encodeURIComponent(text)}`}
              onClick={closeFinder}
              className="text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px]"
            >
              Library
            </Link>
          </div>
        )}
        <span role="status" className="sr-only">
          {candidate
            ? `${position + 1} of ${candidates.length}: ${candidate.kind === "article" ? candidate.match.title : candidate.passage.reference}`
            : ""}
        </span>
      </dialog>
    </>
  );
}
