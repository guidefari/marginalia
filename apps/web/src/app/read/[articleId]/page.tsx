"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { formatPages } from "@marginalia/backend/reading-pages";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Headphones,
  MessagesSquare,
  NotebookPen,
  RotateCcw,
} from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnotationCard } from "@/components/annotation-card";
import { ArticleAsk } from "@/components/article-ask";
import { ArticleBackMatter } from "@/components/article-back-matter";
import { ArticleRenderer } from "@/components/article-renderer";
import { ArticleTags } from "@/components/article-tags";
import {
  BibleAttribution,
  BibleReaderTools,
} from "@/components/bible-reader-tools";
import { BibleWordStudy } from "@/components/bible-word-study";
import { BookUnitNav } from "@/components/book-unit-nav";
import { CompanionCard } from "@/components/companion-card";
import { QueryBoundary } from "@/components/desk/query-boundary";
import { ImpressionSummary } from "@/components/impression-panel";
import { InlineError } from "@/components/in-place";
import { ListenBar } from "@/components/listen-bar";
import {
  AnswerUnfold,
  FoldedArticleAnswers,
  NoteUnfold,
} from "@/components/note-unfold";
import { NotesPanel } from "@/components/notes-panel";
import { ReaderPageGoal } from "@/components/page-goal";
import { ReaderLinkMenu } from "@/components/reader-link-menu";
import { ReaderMap } from "@/components/reader-map";
import {
  READER_COLUMN,
  ReaderOpening,
  ReaderTitle,
} from "@/components/reader-opening";
import { ReaderPane } from "@/components/reader-pane";
import { ReaderReturnChip } from "@/components/reader-return-chip";
import { ReaderToolbar } from "@/components/reader-toolbar";
import {
  ScriptureStudyContent,
  StudySkeleton,
} from "@/components/scripture-study-content";
import { ScriptureStudyHistory } from "@/components/scripture-study-history";
import { studyReferenceLabel } from "@/components/scripture-study-result";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { Sidenotes } from "@/components/sidenotes";
import { SummaryPanel } from "@/components/summary-panel";
import { FINISH_ARTICLE } from "@/components/view-transition";
import { readerMeta } from "@/lib/article-meta";
import { mapBibleAnnotations } from "@/lib/bible-display";
import {
  resolveStudySelection,
  type StudySelection,
  studyVerseElement,
} from "@/lib/bible-study-selection";
import { rangesOverlap } from "@/lib/bible-verses";
import {
  companionNeedsPane,
  useCompanion,
  usePassageHighlight,
} from "@/lib/companion";
import { isSummarySelection } from "@/lib/companion-context";
import { sweepHighlight } from "@/lib/highlight-sweep";
import { findMark, type MarkKind, useHighlights } from "@/lib/highlights";
import { nextSpeed } from "@/lib/listen-speed";
import { defaultColor, type MarkColor, markColor } from "@/lib/mark-colours";
import { paragraphGeometry } from "@/lib/paragraph-geometry";
import {
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  useParagraphs,
} from "@/lib/paragraphs";
import { paragraphAtViewTop, shouldRestorePlace } from "@/lib/place-restore";
import { escapeGoesBack } from "@/lib/reader-escape";
import { revealImpression } from "@/lib/reader-impression";
import { attachLeavingLinks, type LeavingLink } from "@/lib/reader-links";
import {
  answerNotesFromPreviews,
  articleHistoryFromPreviews,
} from "@/lib/reader-previews";
import { backTarget, doneDestination, originRoom } from "@/lib/reader-return";
import {
  DROP_CAP_FAMILIES,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  TYPEFACE_FAMILIES,
  useReaderSettings,
  webSearchEnabled,
} from "@/lib/reader-settings";
import { articleProgress } from "@/lib/reading-clock";
import { useListen, useReadingPosition } from "@/lib/reading-modes";
import { sanitizeHtml } from "@/lib/sanitize";
import { type PassageSource, useSavedPassages } from "@/lib/saved-passages";
import { emitCommand, isOnControl, useShortcuts } from "@/lib/shortcuts";
import { splitLeading, spokenBlock } from "@/lib/spoken-text";
import { findOccurrenceRange, rangeText } from "@/lib/text-range";
import { markFinished } from "@/lib/title-handoff";
import { invalidateTopicSearchCache } from "@/lib/topic-search-cache";
import { useBookProgress, useReadable } from "@/lib/use-book-reading";
import { useEngagementTracker } from "@/lib/use-engagement-tracker";
import { useIsIntersecting } from "@/lib/use-is-intersecting";
import { useListenMediaSession } from "@/lib/use-listen-media-session";
import { useMarginMode } from "@/lib/use-margin-mode";
import {
  useLegacyMarkDefaults,
  useSetMarkDefault,
} from "@/lib/use-mark-default";
import { useMarkPaint } from "@/lib/use-mark-paint";
import { usePageSource } from "@/lib/use-page-source";
import { useParagraphReturn } from "@/lib/use-paragraph-return";
import { usePlaceRestore } from "@/lib/use-place-restore";
import { openAfterLanding, useQuoteLanding } from "@/lib/use-quote-landing";
import { useReadAlongside } from "@/lib/use-read-alongside";
import { useReaderPreviews } from "@/lib/use-reader-previews";
import { useReaderTheme } from "@/lib/use-reader-theme";
import { useSavedAnswerBody } from "@/lib/use-saved-answer-body";
import { useScriptureStudy } from "@/lib/use-scripture-study";
import { useSpeechClip } from "@/lib/use-speech-clip";
import {
  marginNotesPending,
  useStartAnnotation,
} from "@/lib/use-start-annotation";
import { useVerseCursor } from "@/lib/use-verse-cursor";
import { cn } from "@/lib/utils";

export default function ReadPage() {
  const { articleId } = useParams<{ articleId: string }>();
  // SAFETY: Convex validates this route-supplied article ID at every query/mutation boundary.
  const articleKey = articleId as Id<"articles">;
  const searchParams = useSearchParams();
  const sessionKey = searchParams.get("sessionKey");
  const backgroundSession = useQuery(
    api.sessions.getByClientKey,
    sessionKey ? { clientKey: sessionKey } : "skip",
  );
  const sessionId =
    searchParams.get("session") ?? backgroundSession?.sessionId ?? null;
  const router = useRouter();

  // A book is read a part at a time: `article` carries the part on screen
  const {
    article,
    sourceArticle,
    readingTimeZone,
    bibleDisplay,
    isBook,
    unitIndex,
    unitKey,
    outline,
    summaries,
    furthest,
    missingUnit,
    scopeReady,
  } = useReadable(articleKey, searchParams.get("unit"));
  // What a book's marks, notes and kept answers are filed under; absent for an article
  const unit = unitIndex ?? undefined;
  // SAFETY: the route segment is an article id, as the queries below assume
  useStartAnnotation(
    articleId as Id<"articles">,
    isBook ? undefined : article?.annotationStatus,
  );
  const readerData = useReaderPreviews(articleKey, unit, scopeReady);
  const {
    annotations: storedAnnotations,
    notes: articleNotes,
    threads: savedThreads,
    marks: highlightDocs,
  } = readerData;
  const annotations =
    storedAnnotations && bibleDisplay?.primary
      ? mapBibleAnnotations(
          storedAnnotations,
          sourceArticle?.content ?? "",
          bibleDisplay.anchors,
        )
      : storedAnnotations;
  const reflection = useQuery(api.reflections.getByArticle, {
    articleId: articleKey,
  });
  const impression = useQuery(api.impressions.getByArticle, {
    articleId: articleKey,
  });
  const isLoved = useQuery(api.lovedArticles.isLoved, {
    articleId: articleKey,
  });
  const loveArticle = useMutation(api.lovedArticles.love);
  const unloveArticle = useMutation(api.lovedArticles.unlove);
  const reannotate = useAction(api.articles.requestReannotate);

  const [finishing, setFinishing] = useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const notesRequestClose = useRef<
    ((isCurrent?: () => boolean) => Promise<boolean>) | null
  >(null);
  const surfaceIntent = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigation invalidates in-flight pane switches from the previous reading.
  useEffect(
    () => () => {
      ++surfaceIntent.current;
    },
    [articleKey],
  );
  const registerNotesRequestClose = useCallback(
    (close: (isCurrent?: () => boolean) => Promise<boolean>) => {
      notesRequestClose.current = close;
    },
    [],
  );
  const [articleAskOpen, setArticleAskOpen] = useState(false);
  const [studyHistoryOpen, setStudyHistoryOpen] = useState(false);
  const {
    pane: studyPane,
    start: startStudy,
    reopen: reopenStudy,
    close: closeScriptureStudy,
    trackRun: trackStudyRun,
    forget: forgetStudy,
  } = useScriptureStudy(sourceArticle?.bible ? sourceArticle : null);
  const [wordStudy, setWordStudy] = useState<{
    articleKey: string;
    reference: string;
    selection?: string;
  } | null>(null);
  const wordStudyOpen = wordStudy?.articleKey === articleKey;
  const closeStudy = useCallback(async () => {
    if (!(await closeScriptureStudy())) return false;
    setWordStudy(null);
    return true;
  }, [closeScriptureStudy]);
  const biblePreferences = useQuery(
    api.bible.preferences,
    sourceArticle?.bible ? {} : "skip",
  );
  const impressionRef = useRef<HTMLElement>(null);
  const washTimer = useRef<number | null>(null);
  // The room the reader came from, read on the first render. The module holds nothing
  // on the server, and the toolbar only renders once the article has loaded on the client.
  const [origin] = useState<string | null>(() => originRoom());
  useEffect(
    () => () => {
      if (washTimer.current) window.clearTimeout(washTimer.current);
    },
    [],
  );
  const back = backTarget(origin, sessionId);
  const [cursor, setCursor] = useState<number | null>(null);
  // What `o` last cycled through: a paragraph, or a verse by its key in a Bible reading.
  const passageCycle = useRef<{
    scope: HTMLElement | string | null;
    index: number;
  }>({ scope: null, index: -1 });
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    startOffset?: number;
    endOffset?: number;
  } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const [leavingLink, setLeavingLink] = useState<LeavingLink | null>(null);
  const closeLeavingLink = useCallback(() => setLeavingLink(null), []);
  const [backMatter, setBackMatter] = useState<HTMLElement | null>(null);
  const backMatterInView = useIsIntersecting(backMatter);
  // Front matter: the Summary's body covers the text, so the Ask pill steps aside only while it is open
  const [frontMatter, setFrontMatter] = useState<HTMLElement | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const frontMatterInView = useIsIntersecting(summaryOpen ? frontMatter : null);

  const createNote = useMutation(api.userNotes.create);
  const { settings, update: updateSettings, resetText } = useReaderSettings();
  const setMarkDefault = useSetMarkDefault();
  const { colors: legacyMarkDefaults } = useLegacyMarkDefaults();
  const paragraphs = useParagraphs(articleRef, Boolean(article));
  // A link from Notes names the passage to land on, e.g. `?quote=`.
  const landingParagraph = Number.parseInt(searchParams.get("p") ?? "", 10);
  const landed = useQuoteLanding(
    articleRef,
    searchParams.get("quote"),
    paragraphs.version,
    Number.isFinite(landingParagraph) && landingParagraph >= 0
      ? landingParagraph
      : null,
  );
  // Reopening an unfinished article, or a book's part, returns to where the reader stopped.
  // A link that names a passage lands there instead.
  const articleProgressSaved = useQuery(
    api.readingActivity.furthestPlace,
    isBook ? "skip" : { articleId: articleId as any },
  );
  const saved = isBook
    ? furthest && furthest.unit === unitIndex
      ? { percent: furthest.scroll, paragraphIndex: furthest.paragraph }
      : null
    : articleProgressSaved;
  const savedPercent = saved?.percent;
  usePlaceRestore(
    articleRef,
    `${articleId}:${unitIndex ?? ""}`,
    article &&
      shouldRestorePlace({
        percent: savedPercent,
        finished: article.finishedAt !== undefined,
        hasTarget:
          searchParams.get("quote") !== null || searchParams.get("p") !== null,
      })
      ? (savedPercent ?? null)
      : null,
    saved?.paragraphIndex,
    paragraphs.version,
  );
  const position = useReadingPosition(articleRef, paragraphs.layoutVersion);
  const summary = useQuery(api.summaries.getByArticle, {
    articleId: articleKey,
  });
  const companion = useCompanion({
    articleId: articleKey,
    unitIndex: unitIndex,
    containerRef: articleRef,
    title: article?.title ?? "",
    bibleStudySource: Boolean(sourceArticle?.bible?.displayVersionId),
    source:
      (sourceArticle ?? article)
        ? {
            content: (sourceArticle ?? article)?.content,
            contentHtml: (sourceArticle ?? article)?.contentHtml,
          }
        : undefined,
    settings,
  });
  const savedAnswer = useSavedAnswerBody(
    { articleId: articleKey, unitIndex: unit },
    companion.open,
  );
  const [wideAnswerId, setWideAnswerId] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState(
    () => new Map<string, string>(),
  );
  const collapseAnswer = useCallback(() => {
    setWideAnswerId(null);
    savedAnswer.cancel();
    companion.collapse();
  }, [savedAnswer.cancel, companion.collapse]);
  const requestOpenNotes = useCallback(
    async (selection?: {
      text: string;
      startOffset?: number;
      endOffset?: number;
    }) => {
      const intent = ++surfaceIntent.current;
      if (!(await closeStudy()) || intent !== surfaceIntent.current) return;
      if (notesPanelOpen && notesRequestClose.current) {
        if (
          !(await notesRequestClose.current(
            () => intent === surfaceIntent.current,
          ))
        )
          return;
      }
      if (intent !== surfaceIntent.current) return;
      if (selection) setPendingSelection(selection);
      setWideAnswerId(null);
      setStudyHistoryOpen(false);
      setArticleAskOpen(false);
      collapseAnswer();
      setActiveAnnotation(null);
      setNotesPanelOpen(true);
    },
    [collapseAnswer, notesPanelOpen, closeStudy],
  );
  const requestCloseNotes = useCallback(async () => {
    const intent = ++surfaceIntent.current;
    let closed = true;
    if (notesRequestClose.current)
      closed = await notesRequestClose.current(
        () => intent === surfaceIntent.current,
      );
    else setNotesPanelOpen(false);
    if (intent !== surfaceIntent.current) return false;
    return closed;
  }, []);
  const prepareReadingSurface = useCallback(async () => {
    const intent = ++surfaceIntent.current;
    if (
      notesPanelOpen &&
      notesRequestClose.current &&
      !(await notesRequestClose.current(() => intent === surfaceIntent.current))
    )
      return false;
    if (intent !== surfaceIntent.current) return false;
    if (!(await closeStudy()) || intent !== surfaceIntent.current) return false;
    setNotesPanelOpen(false);
    setArticleAskOpen(false);
    setWideAnswerId(null);
    collapseAnswer();
    setActiveAnnotation(null);
    return true;
  }, [closeStudy, collapseAnswer, notesPanelOpen]);
  const requestWordStudy = useCallback(
    async (reference: string, selection?: string) => {
      if (!(await prepareReadingSurface())) return;
      setStudyHistoryOpen(false);
      setWordStudy({ articleKey, reference, selection });
    },
    [articleKey, prepareReadingSurface],
  );
  const requestStudy = useCallback(
    async (range: Range): Promise<string | null> => {
      const body = getArticleBody(articleRef.current);
      const selection =
        sourceArticle?.bible && body
          ? resolveStudySelection(
              sourceArticle.bible.reference,
              sourceArticle.content ?? "",
              body,
              range,
            )
          : null;
      if (!selection)
        return "Select an unambiguous range of up to 40 verses in one chapter. Headings and footnotes cannot be studied.";
      if (!(await prepareReadingSurface()))
        return "Your open pane could not close safely. Save its draft or retry closing it first.";
      setStudyHistoryOpen(false);
      await startStudy(selection);
      return null;
    },
    [sourceArticle, prepareReadingSurface, startStudy],
  );
  const requestStudyHistory = useCallback(async () => {
    if (await prepareReadingSurface()) setStudyHistoryOpen(true);
  }, [prepareReadingSurface]);
  const openSavedStudy = useCallback(
    async (
      studyId: Id<"scriptureStudies">,
      selection: StudySelection,
      runId: Id<"scriptureStudyRuns"> | null,
    ) => {
      if (!(await prepareReadingSurface())) return;
      setStudyHistoryOpen(false);
      await reopenStudy(studyId, selection, runId);
    },
    [prepareReadingSurface, reopenStudy],
  );
  const jumpToStudyVerse = useCallback(
    async (verseId: string) => {
      const body = getArticleBody(articleRef.current);
      const element =
        sourceArticle?.bible && body
          ? studyVerseElement(sourceArticle.bible.reference, body, verseId)
          : null;
      if (!element) return;
      if (
        window.matchMedia("(max-width: 1023px)").matches &&
        !(await closeStudy())
      )
        return;
      requestAnimationFrame(() => {
        element.scrollIntoView({ block: "center", behavior: "instant" });
        element.tabIndex = -1;
        element.focus({ preventScroll: true });
      });
    },
    [sourceArticle?.bible, closeStudy],
  );
  const speechVoice = useQuery(api.userSettings.getSpeechVoice, {})?.selected;
  const speechClip = useSpeechClip(articleKey, speechVoice);
  const listen = useListen(
    articleRef,
    articleId,
    unitKey,
    article?.content,
    article?.contentHtml,
    speechClip,
    article ? { title: article.title, author: article.author } : undefined,
  );
  useListenMediaSession(
    listen,
    article
      ? {
          title: article.title,
          author: article.author,
          url: article.uploadedFileName ? undefined : article.url,
          container: articleRef,
        }
      : undefined,
  );
  const pageSource = usePageSource({
    articleId: articleKey,
    content: sourceArticle?.content,
    contentHtml: sourceArticle?.contentHtml,
    isBook,
    version: paragraphs.version,
    containerRef: articleRef,
  });
  const estimatedPageWords =
    pageSource.config?.paragraphWords.reduce(
      (total, words) => total + words,
      0,
    ) ?? article?.wordCount;
  const {
    trackAnnotationOpen,
    finish,
    retry,
    saveError,
    progress: scrollPercent,
    pendingPageWords,
    pageTrackingUnavailable,
  } = useEngagementTracker({
    articleId,
    sessionId,
    sessionKey,
    requestedMinutes: searchParams.has("minutes")
      ? Number(searchParams.get("minutes"))
      : undefined,
    ready: Boolean(article),
    containerRef: articleRef,
    listening: listen.active,
    paragraphVersion: paragraphs.version,
    pageSource: pageSource.config,
    timeZone: readingTimeZone,
  });
  useBookProgress(
    articleKey,
    unitIndex,
    unitKey,
    useCallback((lastBucket: number) => {
      const body = getArticleBody(articleRef.current);
      if (!body) return null;
      const rect = body.getBoundingClientRect();
      const percent = articleProgress(
        rect.top,
        rect.height,
        window.innerHeight,
      );
      if (Math.min(100, Math.floor(percent / 5) * 5) === lastBucket)
        return null;
      const geometry = paragraphGeometry(articleRef.current);
      if (!geometry) return null;
      return {
        percent,
        paragraphIndex:
          paragraphAtViewTop(geometry.rects.map((rect) => rect.bottom)) ??
          undefined,
      };
    }, []),
    articleRef,
  );
  // The margin fills in ahead of the reader (rung 2f); a book's parts are written by the part
  const alongsideAnchor = useReadAlongside({
    articleId: articleKey,
    enabled: !isBook && article?.annotationStatus === "annotated",
    content: article?.content,
    progress: scrollPercent,
  });
  // A link to a part the book doesn't have opens its first
  useEffect(() => {
    if (missingUnit) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("unit", "0");
      router.replace(`/read/${articleId}?${params}`);
    }
  }, [missingUnit, router, articleId, searchParams]);
  // The open answer's passage, found again by its text so a refresh can restore it.
  const [openRange, setOpenRange] = useState<Range | null>(null);
  const openThread = companion.thread;
  const answerPaneOpen = Boolean(
    openThread &&
      (wideAnswerId === openThread.id || companionNeedsPane(openThread)),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `paragraphs.version` signals the article HTML changed
  useEffect(() => {
    const body = getArticleBody(articleRef.current);
    if (!body || !openThread?.selection) {
      setOpenRange(null);
      return;
    }
    const preferred =
      openThread.paragraphIndex === null
        ? null
        : getParagraphs(body)[openThread.paragraphIndex];
    setOpenRange(
      findOccurrenceRange(
        body,
        openThread.selection,
        preferred,
        openThread.occurrence,
      ),
    );
  }, [
    openThread?.id,
    openThread?.selection,
    openThread?.paragraphIndex,
    openThread?.occurrence,
    paragraphs.version,
  ]);
  usePassageHighlight("companion-passage", openRange);

  // One margin card at a time: an auto annotation or a companion thread
  const [activeAnnotation, setActiveAnnotation] = useState<{
    id: string;
    paragraphIndex: number | null;
  } | null>(null);

  // Where the margin column is, a kept answer's passage is marked and the note is
  // its handle. Elsewhere every answer is marked, since the text is the handle.
  const naturalMarginMode = useMarginMode(
    articleRef,
    Boolean(article),
    settings,
  );
  const marginMode =
    bibleDisplay?.comparing && naturalMarginMode === "sidenotes"
      ? "sheet"
      : naturalMarginMode;
  // Streaming rebuilds `companion.answers` on every chunk, so the passages are
  // keyed by value: only a changed passage makes the text be searched again.
  const passageKey = JSON.stringify(
    [
      ...companion.answers.map((a) => ({
        _id: a.id,
        selection: a.selection,
        paragraphIndex: a.paragraphIndex ?? undefined,
        occurrence: a.occurrence,
        marked: Boolean(a.savedId || a.legacyId) || marginMode !== "sidenotes",
      })),
      ...(savedThreads ?? [])
        .filter(
          (doc) =>
            !companion.answers.some(
              (a) => a.id === doc._id || a.savedId === doc._id,
            ),
        )
        .map((doc) => ({
          _id: doc._id,
          selection: doc.selection,
          paragraphIndex: doc.paragraphIndex,
          occurrence: doc.occurrence,
          marked: true,
        })),
    ].filter((p) => p.selection),
  );
  const passageSources = useMemo<PassageSource[]>(
    () => JSON.parse(passageKey),
    [passageKey],
  );

  const savedPassages = useSavedPassages({
    containerRef: articleRef,
    threads: passageSources,
    version: paragraphs.version,
    activeId: companion.thread?.savedId ?? companion.thread?.id,
    isOpen: (id) =>
      companion.thread?.id === id || companion.thread?.savedId === id,
    onOpen: ({ doc }) => {
      if (
        companion.thread?.id === doc._id ||
        companion.thread?.savedId === doc._id
      )
        collapseAnswer();
      else openAnswer(doc._id);
    },
  });

  // Highlighter and pen marks (registered after saved passages so those win on click)
  const createHighlight = useMutation(api.highlights.create);
  const removeHighlight = useMutation(api.highlights.remove);
  const recolourHighlight = useMutation(api.highlights.setColor);
  const marks = useHighlights({
    containerRef: articleRef,
    docs: highlightDocs,
    version: paragraphs.version,
  });

  useMarkPaint(marks, legacyMarkDefaults);

  const isMarked = useCallback(
    (kind: MarkKind, range: Range) => Boolean(findMark(marks, kind, range)),
    [marks],
  );

  const saveMark = useCallback(
    async (kind: MarkKind, range: Range, color: MarkColor) => {
      // Sweeps at once; the saved mark takes over when the doc arrives
      if (kind === "highlight") sweepHighlight(range, color);
      await createHighlight({
        articleId: articleId as any,
        kind,
        color,
        text: rangeText(range),
        paragraphIndex: paragraphIndexOf(range.startContainer) ?? undefined,
        unitIndex: unit,
      });
    },
    [createHighlight, articleId, unit],
  );

  // A failed toolbar or mark action is shown under the toolbar with Retry, not as a toast
  const [toolbarFailure, setToolbarFailure] = useState<{
    message: string;
    retry: () => Promise<void>;
  } | null>(null);
  const [toolbarRetrying, setToolbarRetrying] = useState(false);
  const [headingElement, setHeadingElement] =
    useState<HTMLHeadingElement | null>(null);
  const attemptToolbar = useCallback(
    async (message: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
        invalidateTopicSearchCache();
        setToolbarFailure(null);
      } catch {
        setToolbarFailure({
          message,
          retry: () => attemptToolbar(message, run),
        });
      }
    },
    [],
  );
  // The heart in the bar and the `v` key take the same path, so a failed love can be retried from the bar.
  const toggleLove = () =>
    void attemptToolbar("Couldn't update loved articles.", async () => {
      if (isLoved) await unloveArticle({ articleId: articleId as any });
      else await loveArticle({ articleId: articleId as any });
    });

  const toggleMark = useCallback(
    (kind: MarkKind, range: Range) =>
      attemptToolbar("Couldn't save that.", async () => {
        const existing = findMark(marks, kind, range);
        if (existing) await removeHighlight({ highlightId: existing.doc._id });
        else await saveMark(kind, range, defaultColor(kind, settings));
      }),
    [marks, removeHighlight, saveMark, settings, attemptToolbar],
  );

  // Picking a colour marks the passage in it, or recolours the mark already
  // there, and becomes the default for that tool until another is picked.
  const markInColor = useCallback(
    async (kind: MarkKind, range: Range, color: MarkColor) => {
      setMarkDefault(kind, color);
      await attemptToolbar("Couldn't save that.", async () => {
        const existing = findMark(marks, kind, range);
        if (!existing) await saveMark(kind, range, color);
        else if (markColor(existing.doc, legacyMarkDefaults) !== color)
          await recolourHighlight({ highlightId: existing.doc._id, color });
      });
    },
    [
      marks,
      saveMark,
      recolourHighlight,
      setMarkDefault,
      legacyMarkDefaults,
      attemptToolbar,
    ],
  );

  const markedColor = useCallback(
    (kind: MarkKind, range: Range) => {
      const existing = findMark(marks, kind, range);
      return existing ? markColor(existing.doc, legacyMarkDefaults) : null;
    },
    [marks, legacyMarkDefaults],
  );

  const startCompanion = useCallback(
    async (args: Parameters<typeof companion.start>[0]) => {
      if (
        !articleRef.current?.contains(args.range.startContainer) ||
        !articleRef.current.contains(args.range.endContainer)
      )
        return;
      const summaryDefinition =
        args.mode === "define" && isSummarySelection(args.range);
      if (args.mode === "define" && article?.bible && !summaryDefinition) {
        const body = getArticleBody(articleRef.current);
        const selection =
          body && sourceArticle?.content
            ? resolveStudySelection(
                article.bible.reference,
                sourceArticle.content,
                body,
                args.range,
              )
            : null;
        if (!selection || selection.startVerseId !== selection.endVerseId)
          return;
        await requestWordStudy(
          studyReferenceLabel(selection.referenceKey),
          args.range.toString().trim(),
        );
        return;
      }
      const intent = ++surfaceIntent.current;
      if (
        notesPanelOpen &&
        notesRequestClose.current &&
        !(await notesRequestClose.current(
          () => intent === surfaceIntent.current,
        ))
      )
        return;
      if (!(await closeStudy()) || intent !== surfaceIntent.current) return;
      setStudyHistoryOpen(false);
      setWideAnswerId(null);
      setArticleAskOpen(false);
      savedAnswer.cancel();
      setActiveAnnotation(null);
      const answerId = companion.start(args);
      if (summaryDefinition && answerId) setWideAnswerId(answerId);
    },
    [
      companion.start,
      savedAnswer.cancel,
      article?.bible,
      sourceArticle?.content,
      requestWordStudy,
      closeStudy,
      notesPanelOpen,
    ],
  );

  useReaderTheme(settings);
  // On a phone the note unfolds in the text; the sheet only opens for its sources and follow-up.
  const [phoneSheet, setPhoneSheet] = useState(false);
  const activeAnnotationId = activeAnnotation?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different note starts folded
  useEffect(() => setPhoneSheet(false), [activeAnnotationId]);
  const closeAnnotation = useCallback(() => {
    if (marginMode === "phone" && phoneSheet) setPhoneSheet(false);
    else setActiveAnnotation(null);
  }, [marginMode, phoneSheet]);

  // A click on the page folds whichever note is open.
  const closeNote = useCallback(() => {
    if (companion.thread || savedAnswer.pendingId) collapseAnswer();
    else closeAnnotation();
  }, [
    companion.thread,
    savedAnswer.pendingId,
    collapseAnswer,
    closeAnnotation,
  ]);

  // Focus mode keeps the passage under discussion lit
  const companionParagraph =
    companion.thread?.paragraphIndex ??
    activeAnnotation?.paragraphIndex ??
    null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reapply after article HTML changes
  useEffect(() => {
    if (companionParagraph === null) return;
    const el = getParagraphs(getArticleBody(articleRef.current))[
      companionParagraph
    ];
    el?.setAttribute("data-companion", "");
    return () => el?.removeAttribute("data-companion");
  }, [companionParagraph, paragraphs.version]);

  // Every in-article jump (¶ links, the map, summary, idea map, cards) goes through here,
  // so Back can return the reader to where they were.
  const {
    top: returnTo,
    jump: jumpToParagraph,
    back: backToParagraph,
  } = useParagraphReturn(articleRef);

  // A plain click on a link to another page opens the link menu rather than navigating
  const articleUrl = article?.url;
  const articleReady = Boolean(article);
  // articleReady and articleId say when the article element exists and when the reader has moved on
  // biome-ignore lint/correctness/useExhaustiveDependencies: those two are re-run triggers, not read inside
  useEffect(() => {
    const el = articleRef.current;
    if (!el || !articleUrl) return;
    const detach = attachLeavingLinks(el, articleUrl, setLeavingLink);
    return () => {
      detach();
      setLeavingLink(null);
    };
  }, [articleUrl, articleReady, articleId]);

  const keepAnswer = useCallback(
    (id: string) =>
      attemptToolbar("Couldn't keep that answer.", async () => {
        if (!(await companion.keep(id))) throw new Error("keep failed");
        toast.success("Kept in your notes");
      }),
    [companion.keep, attemptToolbar],
  );
  const deleteAnswer = useCallback(
    (id: string) =>
      attemptToolbar("Couldn't delete the kept answer.", () =>
        companion.remove(id),
      ),
    [companion.remove, attemptToolbar],
  );
  // A margin note opens whether its answer is from this visit or kept earlier.
  const openAnswer = useCallback(
    async (id: string) => {
      const intent = ++surfaceIntent.current;
      if (!(await closeStudy()) || intent !== surfaceIntent.current) return;
      if (notesPanelOpen) {
        if (
          notesRequestClose.current &&
          !(await notesRequestClose.current(
            () => intent === surfaceIntent.current,
          ))
        )
          return;
      }
      if (intent !== surfaceIntent.current) return;
      setNotesPanelOpen(false);
      setStudyHistoryOpen(false);
      setArticleAskOpen(false);
      setActiveAnnotation(null);
      const live = companion.answers.find(
        (a) => a.id === id || a.savedId === id,
      );
      setWideAnswerId(live && companionNeedsPane(live) ? live.id : null);
      if (live) {
        savedAnswer.cancel();
        companion.openAnswer(live.id);
      } else {
        companion.collapse();
        // SAFETY: IDs originate in previews or the URL; getBody validates the ID and ownership again.
        void savedAnswer.open(id as Id<"companionThreads">);
      }
    },
    [
      companion.answers,
      companion.openAnswer,
      companion.collapse,
      savedAnswer.cancel,
      savedAnswer.open,
      notesPanelOpen,
      closeStudy,
    ],
  );
  const answers = useMemo(
    () => answerNotesFromPreviews(companion.answers, savedThreads),
    [companion.answers, savedThreads],
  );

  // A link from Notes lands on its line, then opens the note or answer it was for, once.
  const linkedNote = searchParams.get("note");
  const linkedAnswer = searchParams.get("answer");
  const openedLink = useRef<string | null>(null);
  useEffect(() => {
    const key = `${articleId}:${unit ?? ""}:${linkedNote ?? ""}:${linkedAnswer ?? ""}`;
    if (openedLink.current === key) return;
    if (!scopeReady) return;
    const action = openAfterLanding({
      // Summary/whole-article answers need no matching body quote. Hydrate the
      // owned saved answer independently; passage landing can still finish later.
      landed: Boolean(linkedAnswer) || landed,
      note: linkedNote,
      answer: linkedAnswer,
      // Deep links may name an answer beyond the first preview page.
      loadedAnswerIds: linkedAnswer
        ? [linkedAnswer]
        : savedThreads?.map((t) => t._id),
    });
    if (!action) return;
    openedLink.current = key;
    if (action.open === "notes") void requestOpenNotes();
    else openAnswer(action.id);
  }, [
    landed,
    linkedNote,
    linkedAnswer,
    savedThreads,
    articleId,
    unit,
    scopeReady,
    openAnswer,
    requestOpenNotes,
  ]);

  // Said under the toolbar, where Listen lives, and gone again on its own.
  const [listenUnavailable, setListenUnavailable] = useState(false);
  useEffect(() => {
    if (!listenUnavailable) return;
    const timer = window.setTimeout(() => setListenUnavailable(false), 6000);
    return () => window.clearTimeout(timer);
  }, [listenUnavailable]);
  const toggleListen = useCallback(() => {
    if (listen.active || listen.needsKey) {
      listen.stop();
    } else if (!listen.supported) {
      setListenUnavailable(true);
    } else {
      listen.speakFrom(position.current ?? position.firstVisible ?? 0);
    }
  }, [listen, position.current, position.firstVisible]);

  // A Bible reading moves by verse. Until its verses are on screen the
  // paragraph cursor still works, so j and k are never dead.
  const verseCursor = useVerseCursor({
    articleRef,
    reference: article?.bible?.reference,
    enabled: Boolean(article?.bible),
    version: paragraphs.version,
  });
  const currentParagraph = () => {
    const focused = paragraphIndexOf(document.activeElement);
    return (
      getParagraphs(getArticleBody(articleRef.current))[
        paragraphIndexOf(verseCursor.startElement()) ??
          focused ??
          cursor ??
          position.current ??
          position.firstVisible ??
          0
      ] ?? null
    );
  };
  const getCurrentParagraphRange = () => {
    const verse = verseCursor.range();
    if (verse) return verse;
    const paragraph = currentParagraph();
    if (!paragraph) return null;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    return range;
  };
  // Unlike the range above, this is null until the reader has put a cursor somewhere.
  const getCursorRange = () => {
    const verse = verseCursor.range();
    if (verse) return verse;
    const at = paragraphIndexOf(document.activeElement) ?? cursor;
    const paragraph =
      at === null
        ? null
        : getParagraphs(getArticleBody(articleRef.current))[at];
    if (!paragraph) return null;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    return range;
  };
  const restoreCursorFocus = () => {
    if (verseCursor.active) {
      // A verse is not an element, so focus rests on the page and j/k keep working.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body)
        active.blur();
      return;
    }
    const at = cursor;
    if (at === null) return;
    getParagraphs(getArticleBody(articleRef.current))[at]?.focus({
      preventScroll: true,
    });
  };
  // A sample reads the start of the paragraph being heard, or the one the
  // reader is on, so voices are compared on the words they'll actually hear
  const voiceSampleText = () => {
    const list = getParagraphs(getArticleBody(articleRef.current));
    const paragraph =
      (listen.index === null ? null : list[listen.index]) ?? currentParagraph();
    const text = paragraph ? spokenBlock(paragraph)?.text : undefined;
    const lang = document.documentElement.lang || "en";
    return (
      (text && splitLeading(text, lang)[0]) ||
      "This is how this voice will read to you."
    );
  };
  const moveParagraph = (direction: 1 | -1) => {
    const list = getParagraphs(getArticleBody(articleRef.current));
    // Verse markup is often divs, which are not numbered paragraphs, so this comes first.
    const from =
      list[
        paragraphIndexOf(document.activeElement) ??
          cursor ??
          position.current ??
          position.firstVisible ??
          0
      ] ?? null;
    if (verseCursor.move(direction, from)) {
      setCursor(null);
      return;
    }
    if (!list.length) return;
    const current = paragraphIndexOf(document.activeElement) ?? cursor;
    const next =
      current === null
        ? (position.current ?? position.firstVisible ?? 0)
        : Math.max(0, Math.min(list.length - 1, current + direction));
    window.getSelection()?.removeAllRanges();
    setCursor(next);
    list[next].tabIndex = -1;
    list[next].focus({ preventScroll: true });
    list[next].scrollIntoView({ block: "center", behavior: "instant" });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reapply after paragraph elements are replaced
  useEffect(() => {
    if (cursor === null) return;
    const el = getParagraphs(getArticleBody(articleRef.current))[cursor];
    el?.setAttribute("data-keyboard-cursor", "");
    return () => el?.removeAttribute("data-keyboard-cursor");
  }, [cursor, paragraphs.version]);

  useShortcuts(
    {
      // Backspace has no default action outside typing targets, which the shortcut dispatcher skips;
      // back() does nothing when there is nowhere to return to.
      Backspace: () => backToParagraph(),
      j: () => moveParagraph(1),
      k: () => moveParagraph(-1),
      r: () => rateArticle(),
      v: () => toggleLove(),
      n: () => void requestOpenNotes(),
      ",": () => emitCommand("open-settings"),
      u: () => emitCommand("toggle-summary"),
      l: () => toggleListen(),
      // Only while listening: otherwise Space scrolls and [ ] do nothing here
      " ": (event) => {
        if (!listen.active || isOnControl(event)) return false;
        listen.togglePause();
      },
      "[": () => (listen.active ? listen.previous() : false),
      "]": () => (listen.active ? listen.next() : false),
      o: () => {
        // A verse's markup may have no numbered paragraph around it.
        const verse = verseCursor.range();
        const paragraph = verse ? null : currentParagraph();
        if (!verse && !paragraph) return;
        // A quote crossing inline/UI boundaries can have multiple DOM marks.
        // Keyboard navigation visits the annotation, not each decoration part.
        const scope = verse ? verseCursor.key : paragraph;
        const annotationHandles = new Map<string, HTMLElement>();
        for (const mark of (verse
          ? getArticleBody(articleRef.current)
          : paragraph
        )?.querySelectorAll<HTMLElement>(".annotation-mark") ?? []) {
          if (verse && !verse.intersectsNode(mark)) continue;
          const id = mark.dataset.annotationId;
          if (id && !annotationHandles.has(id)) annotationHandles.set(id, mark);
        }
        const openers = [
          ...Array.from(annotationHandles.values()).map((annotation) => () => {
            annotation.focus({ preventScroll: true });
            annotation.click();
          }),
          ...savedPassages
            .filter((p) =>
              verse
                ? rangesOverlap(p.range, verse)
                : Boolean(paragraph && p.range.intersectsNode(paragraph)),
            )
            .map((passage) => () => {
              openAnswer(passage.doc._id);
            }),
        ];
        if (!openers.length) return;
        const next =
          passageCycle.current.scope === scope
            ? (passageCycle.current.index + 1) % openers.length
            : 0;
        passageCycle.current = { scope, index: next };
        openers[next]();
      },
    },
    Boolean(article),
    {
      help: {
        group: "Reading",
        keys: [
          ["j  k", "Next and previous paragraph, or verse in the Bible"],
          ["o", "Open the note or conversation on this paragraph or verse"],
          ["r", "Rate the article"],
          ["v", "Love or unlove the article"],
          ["u", "Show or hide the summary"],
          ["n", "Open notes"],
          [",", "Reading settings"],
          ["l", "Listen"],
          ["Space", "Pause or resume, while listening"],
          ["[  ]", "Previous and next paragraph, while listening"],
          ["Backspace", "Back to where you were"],
          ["Esc", "Back to the room you came from"],
        ],
      },
    },
  );

  // ★ and `r` take the reader to the impression at the end, not a popover over the text.
  const rateArticle = useCallback(() => {
    const section = impressionRef.current;
    if (!section) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    washTimer.current = revealImpression(section, reduced, washTimer.current);
  }, []);

  // Esc goes back to the origin room, unless the reader has something open of its own.
  const readerPanelOpen = Boolean(
    wordStudyOpen ||
      activeAnnotation ||
      companion.thread ||
      savedAnswer.pendingId ||
      notesPanelOpen ||
      studyPane ||
      studyHistoryOpen ||
      articleAskOpen ||
      phoneSheet,
  );
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      const selectionActive = !(window.getSelection()?.isCollapsed ?? true);
      if (
        !escapeGoesBack(
          {
            key: e.key,
            defaultPrevented: e.defaultPrevented,
            target: e.target,
          },
          { readerPanelOpen, selectionActive },
          document,
        )
      )
        return;
      e.preventDefault();
      router.push(back.href, { scroll: false });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [readerPanelOpen, back.href, router]);

  const reflectionFlush = useRef<(() => Promise<boolean>) | null>(null);
  const [doneFailed, setDoneFailed] = useState(false);
  const handleDone = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setDoneFailed(false);
    try {
      // Never navigate away from a reflection that failed its acknowledged save.
      if (reflectionFlush.current && !(await reflectionFlush.current()))
        throw new Error("Reflection wasn't saved");
      await finish();
      markFinished();
      const destination = doneDestination(back);
      if (destination.finishing)
        router.push(destination.href, { transitionTypes: [FINISH_ARTICLE] });
      else router.push(destination.href, { scroll: false });
    } catch {
      setDoneFailed(true);
    } finally {
      setFinishing(false);
    }
  }, [finish, finishing, router, back]);
  const doneError = doneFailed && (
    <InlineError
      message="Couldn't save your reading activity. Check your connection."
      onRetry={() => void handleDone()}
      busy={finishing}
    />
  );

  const restoreArticle = useMutation(api.articles.restore);
  const handleRestore = useCallback(
    () =>
      attemptToolbar("Couldn't mark this unread.", async () => {
        await restoreArticle({ articleId: articleKey });
        toast.success("Back in Up next");
      }),
    [articleKey, restoreArticle, attemptToolbar],
  );

  const handleAnnotationSelect = useCallback(
    (annotationId: string | null) => {
      // The click that ends selecting text inside an annotated sentence is a
      // selection, not a request to open its note: opening it would also fold
      // the answer the reader is about to ask for
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim())
        return;
      if (!annotationId) {
        setActiveAnnotation(null);
        return;
      }
      collapseAnswer();
      const mark = articleRef.current?.querySelector(
        `[data-annotation-id="${CSS.escape(annotationId)}"]`,
      );
      setActiveAnnotation({
        id: annotationId,
        paragraphIndex: paragraphIndexOf(mark ?? null),
      });
      trackAnnotationOpen(annotationId);
    },
    [trackAnnotationOpen, collapseAnswer],
  );

  const openAnnotation = annotations?.find(
    (a) => a._id === activeAnnotation?.id,
  );
  const removeNote = useMutation(api.userNotes.remove);

  const handleReflect = useCallback(
    async (text: string) => {
      if (!openAnnotation) return;
      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      await createNote({
        articleId: articleId as any,
        annotationId: openAnnotation._id as any,
        prompt: openAnnotation.content,
        selectedText: openAnnotation.anchorText,
        unitIndex: unit,
        // Keep the prompt with the reflection so the note reads on its own in the Notes panel
        content: `<blockquote><p>${escapeHtml(openAnnotation.content)}</p></blockquote>${paragraphs}`,
        contentPlain: text,
      });
      invalidateTopicSearchCache();
    },
    [openAnnotation, createNote, articleId, unit],
  );

  const handleAddNote = useCallback(
    (selection: { text: string; startOffset?: number; endOffset?: number }) => {
      void requestOpenNotes(selection);
    },
    [requestOpenNotes],
  );

  if (!article) {
    if (bibleDisplay?.error)
      return (
        <main className="mx-auto max-w-3xl px-6 pt-24">
          <InlineError
            message={bibleDisplay.error}
            onRetry={bibleDisplay.retry}
          />
        </main>
      );
    // Opened from the desk, the heading is already known: it is there for the
    // morph to land on while the body loads.
    return (
      <ReaderOpening
        articleId={articleId}
        title={sourceArticle?.title}
        bibleTools={Boolean(sourceArticle?.bible)}
        showSummary={!isBook}
        meta={
          sourceArticle && !sourceArticle.bible?.displayVersionId
            ? readerMeta({
                url: sourceArticle.url,
                uploaded: Boolean(sourceArticle.uploadedFileName),
                author: sourceArticle.author,
                minutes: sourceArticle.estimatedReadMinutes,
              })
            : undefined
        }
        columnStyle={
          {
            maxWidth: MAX_WIDTHS[settings.width],
            "--reader-font": TYPEFACE_FAMILIES[settings.typeface],
            "--reader-size": `${settings.size}px`,
            "--reader-leading": `${LINE_HEIGHTS[settings.spacing]}`,
          } as React.CSSProperties
        }
      />
    );
  }

  const estimatedMinRemaining = article.estimatedReadMinutes
    ? Math.max(
        1,
        Math.round(article.estimatedReadMinutes * (1 - scrollPercent / 100)),
      )
    : null;

  const noteCount =
    (articleNotes?.length ?? 0) +
    (savedThreads ?? []).filter((t) => t.keptAt !== undefined).length;

  const answerThread = companion.thread;
  const answerCard = (inline: boolean, wide = false) =>
    answerThread && (
      <CompanionCard
        key={answerThread.id}
        inline={inline}
        thread={answerThread}
        isBook={isBook}
        wide={wide}
        draft={answerDrafts.get(answerThread.id) ?? ""}
        onDraftChange={(value) =>
          setAnswerDrafts((current) =>
            new Map(current).set(answerThread.id, value),
          )
        }
        onExpand={() => setWideAnswerId(answerThread.id)}
        range={openRange}
        containerRef={articleRef}
        layoutVersion={paragraphs.layoutVersion}
        readerTypography={
          {
            "--reader-pane-size": `${settings.size}px`,
            "--reader-leading": `${LINE_HEIGHTS[settings.spacing]}`,
            fontFamily: TYPEFACE_FAMILIES[settings.typeface],
          } satisfies React.CSSProperties & {
            "--reader-pane-size": string;
            "--reader-leading": string;
          }
        }
        onClose={collapseAnswer}
        onDelete={() => deleteAnswer(answerThread.id)}
        onFollowUp={companion.followUp}
        onRegenerate={companion.regenerate}
        onStop={() => companion.stop(answerThread.id)}
        onJump={jumpToParagraph}
        onKeep={() => keepAnswer(answerThread.id)}
        onResync={() => companion.resync(answerThread.id)}
      />
    );

  return (
    <>
      {bibleDisplay?.fontCss ? (
        <>
          <link
            rel="stylesheet"
            href="https://cdn.youversion.com/platform/1/bible.css"
          />
          <style>{bibleDisplay.fontCss}</style>
        </>
      ) : null}
      {/* Reading progress bar */}
      <div
        className="reading-progress"
        style={{ width: `${scrollPercent}%` }}
      />

      <ReaderToolbar
        pageGoal={
          <ReaderPageGoal
            pendingWords={pendingPageWords}
            savingError={saveError}
          />
        }
        tools={
          article.bible ? (
            <BibleReaderTools
              key={articleId}
              bible={article.bible}
              annotationStatus={article.annotationStatus}
              reflectionMissing={reflection === null}
              articleId={article._id}
              skipReason={article.skipReason}
              display={bibleDisplay}
              onWordStudy={(reference) => void requestWordStudy(reference)}
              onStudyHistory={
                biblePreferences?.enabled
                  ? () => void requestStudyHistory()
                  : undefined
              }
            />
          ) : undefined
        }
        title={article.title}
        headingElement={headingElement}
        originalUrl={article.uploadedFileName ? undefined : article.url}
        backHref={back.href}
        backLabel={back.label}
        maxWidth={`max(${MAX_WIDTHS[settings.width]}, 42rem)`}
        noteCount={noteCount}
        noteCountHasMore={readerData.hasMore}
        onToggleNotes={() => {
          if (notesPanelOpen) void requestCloseNotes();
          else void requestOpenNotes();
        }}
        rating={impression?.rating ?? undefined}
        onRate={rateArticle}
        loved={Boolean(isLoved)}
        onToggleLove={toggleLove}
        listening={listen.active}
        onToggleListen={toggleListen}
        onToggleSummary={() => emitCommand("toggle-summary")}
        onMarkUnread={article.finishedAt === undefined ? null : handleRestore}
        onReannotate={
          isBook
            ? null
            : () =>
                void attemptToolbar("Couldn't re-annotate.", async () => {
                  await reannotate({ articleId: articleId as any });
                  toast.success("Re-annotating with latest vault…");
                })
        }
        settings={{
          settings,
          update: updateSettings,
          resetText,
          listening: listen.active,
          onToggleListen: toggleListen,
          listenSpeed: { value: listen.speed, onChange: listen.setSpeed },
          voiceSample: {
            articleId: articleKey,
            text: voiceSampleText,
            kind: () => {
              const list = getParagraphs(getArticleBody(articleRef.current));
              const paragraph =
                (listen.index === null ? null : list[listen.index]) ??
                currentParagraph();
              if (paragraph && spokenBlock(paragraph)?.heading)
                return "heading";
              return paragraph?.closest("li") ? "list" : "prose";
            },
            listenPlaying:
              listen.active && !listen.paused && listen.status !== "failed",
            listenPaused: listen.paused,
            toggleListenPause: listen.togglePause,
          },
        }}
      />

      {/* Fixed at the bottom, but next to the toolbar in Tab order, so its
          controls are reached before the article, not after its back matter */}
      <ListenBar
        status={listen.status}
        index={listen.index}
        total={paragraphs.count}
        error={listen.error}
        needsKey={listen.needsKey}
        deviceSupported={listen.deviceSupported}
        onTogglePause={listen.togglePause}
        onPrevious={listen.previous}
        onNext={listen.next}
        onStop={listen.stop}
        onRetry={listen.retry}
        onUseDeviceVoice={listen.chooseDeviceVoice}
        following={listen.following}
        speed={listen.speed}
        onFollow={listen.follow}
        onSpeed={() => listen.setSpeed(nextSpeed(listen.speed))}
      />

      {listenUnavailable && (
        <div
          role="status"
          className="fixed z-40 left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top))] rounded-md bg-[var(--reader-surface)] p-3 font-sans text-sm text-[var(--ink)] ring-1 ring-[var(--reader-border)] sm:left-auto sm:right-[calc(var(--notes-inset)+1.5rem)] sm:max-w-sm"
        >
          This browser can't read aloud.
        </div>
      )}

      {toolbarFailure && (
        <div className="fixed z-40 left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top))] rounded-md bg-[var(--reader-surface)] p-3 font-sans ring-1 ring-[var(--reader-border)] sm:left-auto sm:right-[calc(var(--notes-inset)+1.5rem)] sm:max-w-sm">
          <InlineError
            message={toolbarFailure.message}
            busy={toolbarRetrying}
            onRetry={async () => {
              setToolbarRetrying(true);
              await toolbarFailure.retry();
              setToolbarRetrying(false);
            }}
          />
        </div>
      )}

      <nav
        aria-label="Reading controls"
        className="mobile-reader-bar sm:hidden"
      >
        <button
          aria-label={isBook ? "Ask about this book" : "Ask about this article"}
          aria-expanded={articleAskOpen}
          aria-controls={articleAskOpen ? "article-question" : undefined}
          disabled={listen.active || Boolean(saveError)}
          onClick={async () => {
            const wasOpen = articleAskOpen;
            if (!(await prepareReadingSurface())) return;
            setStudyHistoryOpen(false);
            setActiveAnnotation(null);
            collapseAnswer();
            setWideAnswerId(null);
            setArticleAskOpen(!wasOpen);
          }}
        >
          <MessagesSquare size={19} />
          Ask
        </button>
        <button onClick={() => void requestOpenNotes()}>
          <NotebookPen size={19} />
          Notes
          {noteCount || readerData.hasMore
            ? ` · ${noteCount}${readerData.hasMore ? "+" : ""}`
            : ""}
        </button>
        <button onClick={toggleListen} aria-pressed={listen.active}>
          <Headphones size={19} />
          {listen.active ? "Stop" : "Listen"}
        </button>
        {article?.finishedAt === undefined ? (
          <button disabled={finishing} onClick={handleDone}>
            <Check size={19} />
            {finishing ? "Saving…" : "Done"}
          </button>
        ) : (
          <button onClick={handleRestore}>
            <RotateCcw size={19} />
            Mark unread
          </button>
        )}
      </nav>
      {doneError && (
        <div className="fixed z-40 left-3 right-3 bottom-20 rounded-lg bg-[var(--reader-surface)] p-3 text-sm font-sans ring-1 ring-[var(--reader-border)] sm:hidden">
          {doneError}
        </div>
      )}
      {saveError && (
        <div
          role="status"
          className="fixed z-40 left-3 right-3 bottom-20 rounded-lg bg-[var(--reader-surface)] p-3 text-sm font-sans ring-1 ring-[var(--reader-border)]"
        >
          Reading activity is waiting to sync.{" "}
          <button
            className="underline min-h-11"
            onClick={() => void retry().catch(() => {})}
          >
            Retry
          </button>
        </div>
      )}

      {/* Selection toolbar — Ask / Explain / Simplify, note and copy */}
      {(savedAnswer.pendingId || savedAnswer.error) && (
        <div
          role="status"
          className="fixed z-40 left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top))] rounded-md bg-[var(--reader-surface)] p-3 font-sans text-sm text-[var(--ink)] ring-1 ring-[var(--reader-border)] sm:left-auto sm:right-[calc(var(--notes-inset)+1.5rem)] sm:max-w-sm"
        >
          {savedAnswer.error ?? "Loading saved answer…"}{" "}
          <button
            type="button"
            className="underline min-h-11"
            onClick={savedAnswer.cancel}
          >
            {savedAnswer.pendingId ? "Cancel" : "Dismiss"}
          </button>
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {verseCursor.announcement}
      </div>
      <SelectionToolbar
        containerRef={articleRef}
        getCurrentParagraphRange={getCurrentParagraphRange}
        getCursorRange={getCursorRange}
        restoreCursorFocus={restoreCursorFocus}
        onAddNote={handleAddNote}
        onCompanion={startCompanion}
        onDeepStudy={
          sourceArticle?.bible && biblePreferences?.enabled
            ? requestStudy
            : undefined
        }
        depth={settings.answerDepth}
        onDepthChange={(answerDepth) => updateSettings({ answerDepth })}
        web={webSearchEnabled(settings)}
        onWebChange={(on) =>
          updateSettings({ webSearch: on ? "always" : "off" })
        }
        isMarked={isMarked}
        onToggleMark={toggleMark}
        onMarkInColor={markInColor}
        markedColor={markedColor}
        defaultColors={{
          highlight: settings.highlighter,
          underline: settings.pen,
        }}
      />

      {settings.map && (
        <ReaderMap
          containerRef={articleRef}
          version={paragraphs.version}
          position={position}
          marked={companionParagraph}
          saved={savedPassages.map((p) => p.doc.paragraphIndex ?? -1)}
          ticks={(highlightDocs ?? []).flatMap((d) =>
            d.paragraphIndex === undefined ? [] : [d.paragraphIndex],
          )}
          onJump={jumpToParagraph}
          minutesLeft={estimatedMinRemaining}
        />
      )}

      {/* Article content; padded so the docked notes pane never covers the text */}
      <div
        className="reader-reflow pr-[var(--notes-inset)] transition-[padding] duration-200"
        onTransitionEnd={(e) => {
          // Margin cards measure the gutter on resize, so tell them it changed.
          if (e.target === e.currentTarget)
            window.dispatchEvent(new Event("resize"));
        }}
      >
        <div
          className={
            bibleDisplay?.comparison
              ? "reader-comparison-layout mx-auto grid max-w-[100rem] items-start md:grid-cols-2 md:gap-8"
              : undefined
          }
        >
          <article
            ref={articleRef}
            tabIndex={-1}
            className={cn(
              READER_COLUMN,
              "reader-arriving transition-[max-width] duration-300",
              settings.numbers && "reader-numbers",
              settings.focus && "reader-focus",
              settings.align === "justify" && "reader-justify",
              settings.paragraphs === "indented" && "reader-indented",
              // A PDF's first block is often a licence line or an author list, so
              // nothing in it is a lead worth a drop cap
              settings.dropCap !== "off" &&
                !article.uploadedFileName &&
                "reader-dropcap",
            )}
            data-dropcap-style={settings.dropCap}
            data-margin={marginMode}
            style={
              {
                maxWidth: MAX_WIDTHS[settings.width],
                "--reader-font": TYPEFACE_FAMILIES[settings.typeface],
                "--reader-size": `${settings.size}px`,
                "--reader-leading": LINE_HEIGHTS[settings.spacing],
                "--dropcap-lines": settings.dropCapLines,
                "--dropcap-font":
                  settings.dropCap === "off"
                    ? undefined
                    : DROP_CAP_FAMILIES[settings.dropCap],
              } as React.CSSProperties
            }
          >
            <header className="mb-10">
              <ReaderTitle
                articleId={articleId}
                title={article.title}
                headingRef={setHeadingElement}
              />
              <p
                data-testid="reader-meta"
                className="text-sm font-sans text-[var(--ink-muted)]"
              >
                {readerMeta({
                  url: article.url,
                  uploaded: Boolean(article.uploadedFileName),
                  author: article.author,
                  minutes: article.estimatedReadMinutes,
                  part:
                    isBook && outline && unitIndex !== null
                      ? { index: unitIndex, of: outline.length }
                      : undefined,
                })}
                {!isBook && estimatedPageWords != null
                  ? ` · About ${formatPages(estimatedPageWords)} estimated pages`
                  : ""}
              </p>
              {(pageSource.message || pageTrackingUnavailable) && (
                <p
                  className="mt-2 font-sans text-xs text-[var(--ink-muted)]"
                  role={pageSource.failed ? "status" : undefined}
                >
                  {pageSource.message ??
                    "Estimated pages are paused for this source or timezone. Reopen the article to retry."}
                  {pageSource.failed && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={pageSource.retry}
                      >
                        Retry
                      </button>
                    </>
                  )}
                </p>
              )}
              <ArticleTags articleId={articleId as any} />
              {impression && <ImpressionSummary impression={impression} />}
            </header>

            {(!isBook || summary) && (
              <div ref={setFrontMatter}>
                <SummaryPanel
                  studySource={Boolean(sourceArticle?.bible?.displayVersionId)}
                  articleId={articleKey}
                  title={article.title}
                  content={(sourceArticle ?? article).content}
                  contentHtml={(sourceArticle ?? article).contentHtml}
                  wordCount={article.wordCount}
                  summary={summary}
                  containerRef={articleRef}
                  onJump={(index) => {
                    const verse = bibleDisplay?.anchors.find(
                      (anchor) => anchor.sourceParagraph === index,
                    );
                    const target = verse
                      ? articleRef.current?.querySelector(
                          `[data-usfm~="${verse.verseId}"]`,
                        )
                      : null;
                    jumpToParagraph(
                      target ? (paragraphIndexOf(target) ?? index) : index,
                    );
                  }}
                  canGenerate={!isBook}
                  onExpandedChange={setSummaryOpen}
                  contentVersion={paragraphs.version}
                />
              </div>
            )}
            <div
              data-yv-sdk={bibleDisplay?.primary ? "" : undefined}
              data-slot={
                bibleDisplay?.primary ? "yv-bible-renderer" : undefined
              }
              className={
                bibleDisplay?.primary
                  ? "licensed-bible-text licensed-bible-view"
                  : undefined
              }
              dir="auto"
              lang={bibleDisplay?.primary?.language}
            >
              <ArticleRenderer
                content={article.content ?? ""}
                contentHtml={article.contentHtml ?? ""}
                annotations={annotations ?? []}
                activeAnnotationId={activeAnnotation?.id ?? null}
                onAnnotationSelect={handleAnnotationSelect}
              />
            </div>

            {/* Back matter: the Ask pill steps aside while it is in view */}
            <div ref={setBackMatter}>
              {article.bible ? (
                <BibleAttribution
                  bible={article.bible}
                  display={bibleDisplay}
                />
              ) : null}
              {isBook && outline && unitIndex !== null && (
                <BookUnitNav
                  articleId={articleId}
                  unitIndex={unitIndex}
                  outline={outline}
                  summaries={summaries}
                />
              )}
              {!isBook && (
                <ArticleBackMatter
                  articleId={articleId}
                  reflection={reflection}
                  impressionRef={impressionRef}
                  reflectionFlush={reflectionFlush}
                  onDone={handleDone}
                  doneError={doneError}
                  finished={article.finishedAt !== undefined}
                  onMarkUnread={handleRestore}
                />
              )}
            </div>
            {readerData.hasMore && (
              <button
                type="button"
                className="mt-6 min-h-11 font-sans text-sm underline"
                disabled={readerData.loadingMore}
                onClick={readerData.loadMore}
              >
                {readerData.loadingMore
                  ? "Loading more…"
                  : "Load more margin notes and marks"}
              </button>
            )}
          </article>
          {bibleDisplay?.comparison ? (
            <aside
              aria-label={`Compare with ${bibleDisplay.comparison.title}`}
              className="reader-comparison licensed-bible-view min-w-0 px-6 pb-24 pt-8 md:pt-[calc(5rem+env(safe-area-inset-top))]"
              style={
                {
                  fontSize: `${settings.size}px`,
                  lineHeight: LINE_HEIGHTS[settings.spacing],
                  "--reader-font": TYPEFACE_FAMILIES[settings.typeface],
                  "--reader-size": `${settings.size}px`,
                  "--reader-leading": LINE_HEIGHTS[settings.spacing],
                } as React.CSSProperties
              }
            >
              <h2 className="mb-5 font-sans text-base">
                {bibleDisplay.comparison.title} ·{" "}
                {bibleDisplay.comparison.abbreviation}
              </h2>
              <div
                data-yv-sdk=""
                data-slot="yv-bible-renderer"
                dir="auto"
                lang={bibleDisplay.comparison.language}
                className="licensed-bible-text"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(bibleDisplay.comparison.html, {
                    ADD_TAGS: ["sup"],
                    ADD_ATTR: ["style", "class", "target"],
                  }),
                }}
              />
              <p className="mt-6 whitespace-pre-line font-sans text-xs leading-5 text-[var(--reader-fg-soft)]">
                {bibleDisplay.comparison.copyright}
              </p>
              <a
                className="inline-flex min-h-11 items-center font-sans text-sm underline underline-offset-4"
                href={bibleDisplay.comparison.publisherUrl}
                target="_blank"
                rel="noreferrer"
              >
                {bibleDisplay.comparison.publisher}
              </a>
            </aside>
          ) : null}
        </div>
      </div>

      <Sidenotes
        key={`${articleId}:${unitIndex ?? ""}`}
        containerRef={articleRef}
        mode={marginMode}
        version={paragraphs.version}
        layoutKey={settings}
        annotations={annotations}
        userNotes={articleNotes}
        marks={marks}
        waiting={marginNotesPending(article) || alongsideAnchor !== null}
        waitingAnchor={alongsideAnchor}
        openId={activeAnnotationId}
        answers={answers}
        openAnswerId={answerPaneOpen ? null : companion.openId}
        onOpenAnswer={openAnswer}
        onClose={closeNote}
        onOpenNotes={() => void requestOpenNotes()}
        openCard={
          companion.thread && !answerPaneOpen ? (
            answerCard(true)
          ) : openAnnotation && activeAnnotation ? (
            <AnnotationCard
              scripture={Boolean(
                sourceArticle?.bible && biblePreferences?.enabled,
              )}
              inline
              annotation={openAnnotation}
              paragraphIndex={activeAnnotation.paragraphIndex}
              reflections={(articleNotes ?? [])
                .filter((note) => note.annotationId === openAnnotation._id)
                .sort((a, b) => a.createdAt - b.createdAt)}
              onReflect={handleReflect}
              onDeleteReflection={(id) =>
                removeNote({ noteId: id as any }).then(
                  invalidateTopicSearchCache,
                )
              }
              containerRef={articleRef}
              layoutVersion={paragraphs.layoutVersion}
              onClose={closeAnnotation}
              onJump={jumpToParagraph}
            />
          ) : null
        }
      />

      {marginMode === "phone" && companion.thread && !answerPaneOpen && (
        <AnswerUnfold
          containerRef={articleRef}
          version={paragraphs.version}
          id={companion.thread.id}
          paragraphIndex={companion.thread.paragraphIndex}
        >
          {answerCard(true)}
        </AnswerUnfold>
      )}

      {marginMode === "sheet" &&
        companion.thread &&
        !answerPaneOpen &&
        answerCard(false)}

      {marginMode !== "sidenotes" && (
        <FoldedArticleAnswers
          containerRef={articleRef}
          version={paragraphs.version}
          items={answers.filter(
            (a) =>
              a.paragraphIndex === null &&
              !a.selection &&
              a.id !== companion.openId,
          )}
          onOpen={openAnswer}
        />
      )}

      {marginMode === "phone" && (
        <NoteUnfold
          containerRef={articleRef}
          version={paragraphs.version}
          annotation={openAnnotation ?? null}
          paragraph={
            activeAnnotation?.paragraphIndex != null
              ? activeAnnotation.paragraphIndex + 1
              : null
          }
          sheetOpen={phoneSheet}
          onFold={closeAnnotation}
          onOpenCard={() => setPhoneSheet(true)}
        />
      )}

      {openAnnotation &&
        activeAnnotation &&
        marginMode !== "sidenotes" &&
        (marginMode !== "phone" || phoneSheet) && (
          <AnnotationCard
            scripture={Boolean(
              sourceArticle?.bible && biblePreferences?.enabled,
            )}
            key={openAnnotation._id}
            annotation={openAnnotation}
            paragraphIndex={activeAnnotation.paragraphIndex}
            reflections={(articleNotes ?? [])
              .filter((note) => note.annotationId === openAnnotation._id)
              .sort((a, b) => a.createdAt - b.createdAt)}
            onReflect={handleReflect}
            onDeleteReflection={(id) =>
              removeNote({ noteId: id as any }).then(invalidateTopicSearchCache)
            }
            containerRef={articleRef}
            layoutVersion={paragraphs.layoutVersion}
            onClose={closeAnnotation}
            onJump={jumpToParagraph}
          />
        )}

      {/* A book is asked about through its outline and matching passages, with the part on screen as the ¶ numbers' home */}
      <ArticleAsk
        noun={isBook ? "book" : "article"}
        open={articleAskOpen}
        onOpenChange={setArticleAskOpen}
        hidden={Boolean(
          wordStudyOpen ||
            companion.thread ||
            studyPane ||
            studyHistoryOpen ||
            activeAnnotation ||
            notesPanelOpen ||
            backMatterInView ||
            frontMatterInView ||
            listen.active ||
            saveError,
        )}
        onAsk={async (question) => {
          if (!(await prepareReadingSurface())) return;
          setStudyHistoryOpen(false);
          savedAnswer.cancel();
          setActiveAnnotation(null);
          companion.startArticle(question);
        }}
        depth={settings.answerDepth}
        onDepthChange={(answerDepth) => updateSettings({ answerDepth })}
        web={webSearchEnabled(settings)}
        onWebChange={(on) =>
          updateSettings({ webSearch: on ? "always" : "off" })
        }
        history={articleHistoryFromPreviews(companion.answers, savedThreads)}
        onOpen={openAnswer}
      />

      <ReaderReturnChip entry={returnTo} onBack={backToParagraph} />
      {leavingLink ? (
        <ReaderLinkMenu
          key={leavingLink.href}
          link={leavingLink}
          onClose={closeLeavingLink}
        />
      ) : null}

      {answerThread && answerPaneOpen && answerCard(false, true)}

      {wordStudy?.articleKey === articleKey && (
        <ReaderPane
          title={
            wordStudy.selection
              ? `Word study · ${wordStudy.selection}`
              : "Original-language word study"
          }
          focusFallback={articleRef}
          style={{
            "--reader-pane-size": `${settings.size}px`,
            "--reader-leading": `${LINE_HEIGHTS[settings.spacing]}`,
            fontFamily: TYPEFACE_FAMILIES[settings.typeface],
          }}
          onClose={() => {
            surfaceIntent.current++;
            setWordStudy(null);
          }}
        >
          <div className="text-[length:var(--reader-size)] leading-[var(--reader-leading)]">
            <BibleWordStudy
              key={`${wordStudy.reference}:${wordStudy.selection ?? ""}`}
              reference={wordStudy.reference}
              selectedText={wordStudy.selection}
            />
          </div>
        </ReaderPane>
      )}

      {(studyPane || studyHistoryOpen) && (
        <ReaderPane
          title={
            studyPane
              ? `Deep study · ${studyReferenceLabel(studyPane.selection.referenceKey)}`
              : "Saved deep studies"
          }
          onClose={() => {
            if (studyHistoryOpen) setStudyHistoryOpen(false);
            else void closeStudy();
          }}
          focusFallback={articleRef}
          style={
            {
              "--reader-pane-size": `${settings.size}px`,
              "--reader-leading": `${LINE_HEIGHTS[settings.spacing]}`,
              fontFamily: TYPEFACE_FAMILIES[settings.typeface],
            } satisfies React.CSSProperties & {
              "--reader-pane-size": string;
              "--reader-leading": string;
            }
          }
        >
          <div className="pb-8 text-[length:var(--reader-size)] leading-[var(--reader-leading)]">
            <QueryBoundary
              key={
                studyPane?.studyId ??
                (studyHistoryOpen ? "history" : "starting")
              }
              fallback={(retry) => (
                <InlineError
                  message="This saved study could not load. Reopen its latest result or try again."
                  onRetry={retry}
                />
              )}
            >
              {studyHistoryOpen ? (
                <ScriptureStudyHistory
                  articleId={articleKey}
                  onOpen={(...args) => void openSavedStudy(...args)}
                />
              ) : studyPane?.studyId ? (
                <ScriptureStudyContent
                  key={studyPane.studyId}
                  studyId={studyPane.studyId}
                  onAnchor={(verseId) => void jumpToStudyVerse(verseId)}
                  onRun={trackStudyRun}
                  onRemoved={forgetStudy}
                />
              ) : studyPane?.pending ? (
                <StudySkeleton />
              ) : null}
            </QueryBoundary>
            {studyPane?.error && (
              <InlineError
                message={studyPane.error}
                onRetry={() => {
                  if (studyPane.studyId) void closeStudy();
                  else void startStudy(studyPane.selection);
                }}
              />
            )}
          </div>
        </ReaderPane>
      )}

      {/* Notes side panel */}
      <NotesPanel
        articleId={articleId}
        unitIndex={unit}
        isOpen={notesPanelOpen}
        initialNoteId={linkedNote}
        onClose={() => setNotesPanelOpen(false)}
        pendingSelection={pendingSelection}
        onClearSelection={() => setPendingSelection(null)}
        onJump={jumpToParagraph}
        onAnswerDeleted={companion.forget}
        onRegisterRequestClose={registerNotesRequestClose}
      />
    </>
  );
}
