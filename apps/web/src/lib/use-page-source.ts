"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { countWords, pageSourceKey } from "@marginalia/backend/reading-pages";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import type { PageCoverageConfig } from "./page-coverage";
import { paragraphGeometry } from "./paragraph-geometry";

export function usePageSource({
  articleId,
  content,
  contentHtml,
  isBook,
  version,
  containerRef,
}: {
  articleId: Id<"articles">;
  content?: string;
  contentHtml?: string;
  isBook: boolean;
  version: number;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const prepare = useMutation(api.readingPages.prepareSource);
  const [result, setResult] = useState<{
    key: string;
    version: number;
    config?: PageCoverageConfig;
    message?: string;
    failed?: boolean;
  }>();
  const [retry, setRetry] = useState(0);
  const key = `${articleId}:${pageSourceKey(content, contentHtml)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is an explicit user-requested attempt epoch
  useEffect(() => {
    if (isBook || (!content && !contentHtml) || version < 1) return;
    let disposed = false;
    const geometry = paragraphGeometry(containerRef.current);
    if (!geometry?.elements.length) {
      setResult({
        key,
        version,
        message: "Estimated pages are unavailable for this text.",
      });
      return;
    }
    const paragraphWords = geometry.elements.map((el) =>
      countWords(el.textContent ?? ""),
    );
    void prepare({
      articleId,
      sourceKey: pageSourceKey(content, contentHtml),
      paragraphWords,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
      .then((value) => {
        if (disposed) return;
        if ("unavailable" in value)
          setResult({ key, version, message: value.unavailable });
        else setResult({ key, version, config: value });
      })
      .catch(() => {
        if (!disposed)
          setResult({
            key,
            version,
            message: "Estimated pages could not start.",
            failed: true,
          });
      });
    return () => {
      disposed = true;
    };
  }, [
    articleId,
    content,
    contentHtml,
    isBook,
    version,
    containerRef,
    prepare,
    key,
    retry,
  ]);
  const current =
    !isBook && result?.key === key && result.version === version
      ? result
      : undefined;
  return {
    config: current?.config,
    message: isBook
      ? "Books do not count toward estimated pages yet."
      : current?.message,
    failed: current?.failed,
    retry: useCallback(() => setRetry((n) => n + 1), []),
  };
}
