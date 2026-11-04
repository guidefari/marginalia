import { WORDS_PER_MINUTE } from "../constants";
import { EPUB_LIMITS } from "./archive";
import { epubAnchor } from "./structure";
import type { EpubResult, EpubSpineItem, EpubUnit, SourceSpan } from "./types";

const wordsOf = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
const bytesOf = (html: string, text: string) =>
  new TextEncoder().encode(html).length + new TextEncoder().encode(text).length;

export function epubUnits(
  spine: readonly EpubSpineItem[],
): EpubResult<readonly EpubUnit[]> {
  const units: EpubUnit[] = [];
  const targets = new Map<string, number>();
  let html = "";
  let text = "";
  let title = "";
  let sourceSpans: SourceSpan[] = [];
  const close = () => {
    if (html)
      units.push({
        title,
        content: text,
        contentHtml: html,
        wordCount: wordsOf(text),
        estimatedReadMinutes: Math.max(
          1,
          Math.ceil(wordsOf(text) / WORDS_PER_MINUTE),
        ),
        sourceSpans,
      });
    html = "";
    text = "";
    title = "";
    sourceSpans = [];
  };
  for (const [spineIndex, item] of spine.entries()) {
    if (wordsOf(text) >= EPUB_LIMITS.shortItemWords) close();
    if (!title || wordsOf(text) < EPUB_LIMITS.shortItemWords)
      title = item.title;
    for (const block of item.blocks) {
      if (
        wordsOf(block.text) > EPUB_LIMITS.unitWords ||
        bytesOf(block.html, block.text) > EPUB_LIMITS.unitBytes
      )
        return { ok: false, reason: "too_long" };
      if (
        html &&
        (wordsOf(`${text} ${block.text}`) > EPUB_LIMITS.unitWords ||
          bytesOf(html + block.html, `${text}\n\n${block.text}`) >
            EPUB_LIMITS.unitBytes)
      ) {
        close();
        title = item.title;
      }
      if (!targets.has(item.href)) targets.set(item.href, units.length);
      for (const match of block.html.matchAll(/ id="([^"]+)"/gu)) {
        const id = match[1];
        if (id && !targets.has(id)) targets.set(id, units.length);
      }
      const previous = sourceSpans.at(-1);
      if (previous?.spineIndex === spineIndex)
        sourceSpans[sourceSpans.length - 1] = {
          spineIndex,
          start: previous.start,
          end: block.end,
        };
      else sourceSpans.push({ spineIndex, start: block.start, end: block.end });
      text += `${html ? "\n\n" : ""}${block.text}`;
      html += block.html;
      if (units.length >= EPUB_LIMITS.units)
        return { ok: false, reason: "too_long" };
    }
  }
  close();
  if (units.length > EPUB_LIMITS.units)
    return { ok: false, reason: "too_long" };
  if (!units.some((unit) => unit.content.trim()))
    return { ok: false, reason: "empty" };
  return {
    ok: true,
    value: units.map((unit) => ({
      ...unit,
      contentHtml: unit.contentHtml.replace(
        / data-epub-href="([^"]+)"/gu,
        (_match, encoded: string) => {
          const target = decodeURIComponent(encoded);
          const [href, fragment] = target.split("#");
          const spineIndex = spine.findIndex((item) => item.href === href);
          const anchor =
            fragment && spineIndex >= 0
              ? epubAnchor(spineIndex, decodeURIComponent(fragment))
              : undefined;
          const index = targets.get(anchor ?? href ?? "");
          return index === undefined
            ? ""
            : ` href="?unit=${index}${anchor ? `#${anchor}` : ""}"`;
        },
      ),
    })),
  };
}
