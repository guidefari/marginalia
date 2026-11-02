import type { NarrationKind } from "@marginalia/backend/narration";
import { paragraphText } from "./paragraphs";

/** The most one clip may carry; the backend refuses more (04-synthesis-and-cache). */
export const MAX_CLIP_CHARS = 2000;
/** The first clip of a listen stays short so the voice starts within about 2 s (D-TTS-023). */
export const LEAD_CHARS = 300;

/** What the voice says for one block, and whether the block is a heading (longer pause after it). */
export interface SpokenBlock {
  text: string;
  heading: boolean;
  kind?: NarrationKind;
}

const SKIPPED_ANCESTORS = "pre, table";
const FOOTNOTE_MARKER = /^[\s\d\p{P}\p{S}]+$/u;
const BRACKETED_NUMBER = /\[\d+\]/g;
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"’”]+$/;
const CLOSING_PUNCTUATION = /[.!?…:;]["'”’)\]]*$/;

function linkSentence(match: string): string {
  const trailing = match.match(TRAILING_PUNCTUATION)?.[0] ?? "";
  const url = match.slice(0, match.length - trailing.length);
  try {
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    const host = new URL(href).hostname.replace(/^www\./i, "");
    return `a link to ${host}${trailing}`;
  } catch {
    return match;
  }
}

/** A block made only of code reads as noise, whatever tag wraps it. */
function isCodeOnly(el: HTMLElement): boolean {
  if (el.tagName === "CODE") return true;
  const codes = el.querySelectorAll("code");
  if (codes.length === 0) return false;
  const clone = el.cloneNode(true) as HTMLElement;
  for (const code of clone.querySelectorAll("code")) code.remove();
  return !(clone.textContent ?? "").trim();
}

/**
 * Rules 1 to 5 of the blueprint's spoken-text section: the whole text of one
 * block as the voice should say it, or `null` when the block is skipped.
 */
export function spokenBlock(el: HTMLElement): SpokenBlock | null {
  if (el.closest(SKIPPED_ANCESTORS) || isCodeOnly(el)) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  return cleanedSpokenBlock(clone, /^H[1-6]$/.test(el.tagName));
}

function cleanedSpokenBlock(
  clone: HTMLElement,
  heading = false,
): SpokenBlock | null {
  for (const br of clone.querySelectorAll("br")) br.replaceWith(" ");
  for (const block of clone.querySelectorAll("p, div, li")) block.append(" ");
  for (const sup of clone.querySelectorAll("sup")) {
    // Numeric exponents are content, not citation markers.
    const before = sup.previousSibling?.textContent ?? "";
    if (
      sup.querySelector('a[href^="#"], [role="doc-noteref"]') ||
      sup.matches('[role="doc-noteref"]')
    )
      sup.remove();
    else if (
      (/(?:\b\d{1,2}|\b[a-z])$/i.test(before) ||
        Boolean(sup.closest("math, [data-math], .math"))) &&
      /^\d+$/.test(sup.textContent ?? "")
    )
      sup.replaceWith(` to the power of ${sup.textContent} `);
    else if (FOOTNOTE_MARKER.test(sup.textContent ?? "")) sup.remove();
  }
  // Clean joined prose so citations spanning inline markup are removed too.
  // Hold exact code and math aside: arr[12] is not a citation.
  const protectedText: string[] = [];
  const original = clone.textContent ?? "";
  let marker = crypto.randomUUID();
  while (original.includes(marker)) marker = crypto.randomUUID();
  for (const element of clone.querySelectorAll("code, math")) {
    if (!clone.contains(element)) continue;
    const slot = protectedText.push(element.textContent ?? "") - 1;
    element.replaceWith(`\uE000${marker}:${slot}\uE001`);
  }
  let text = paragraphText(clone)
    .replace(BRACKETED_NUMBER, "")
    .replace(
      new RegExp(`\uE000${marker}:(\\d+)\uE001`, "g"),
      (_, slot) => protectedText[Number(slot)] ?? "",
    )
    .replace(BARE_URL, linkSentence)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (heading && !CLOSING_PUNCTUATION.test(text)) text += ".";
  return { text, heading };
}

/** A listening anchor never changes the reader's canonical paragraph numbering. */
export interface NarrationEntry {
  element: HTMLElement;
  sourceIndex: number;
  sourceEndIndex?: number;
  spoken: SpokenBlock;
}

function imageEvidence(image: HTMLElement): string {
  const alt = image.getAttribute("alt")?.trim();
  const ids = [
    image.getAttribute("aria-describedby"),
    image.getAttribute("aria-details"),
  ]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/);
  const references = ids.flatMap((id) => {
    const element = image.ownerDocument.getElementById(id);
    return element?.textContent?.trim() ? [element] : [];
  });
  const readElsewhere = references.some((element) =>
    element.closest("[data-para]"),
  );
  const descriptions = references
    .filter((element) => !element.closest("[data-para]"))
    .map((element) => element.textContent?.trim())
    .filter(Boolean);
  if (
    !descriptions.length &&
    !readElsewhere &&
    (image.getAttribute("alt") === "" ||
      image.getAttribute("role") === "presentation")
  )
    return "";
  const caption = image
    .closest("figure")
    ?.querySelector("figcaption")
    ?.textContent?.trim();
  // Captions have their own source anchor; do not narrate them twice.
  const evidence = [
    ...new Set(
      [alt === caption ? undefined : alt, ...descriptions].filter(Boolean),
    ),
  ];
  return evidence.length
    ? `Image description provided by the source: ${evidence.join(". ")}`
    : readElsewhere
      ? "An image is described in the article's accompanying text."
      : caption
        ? "An image accompanies the following caption. Its visual details are not available for this narration."
        : "An image appears here, but no description was provided. Its visual details are not available for this narration.";
}

function tableEvidence(table: HTMLElement): string {
  const cellText = (element: Element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const image of clone.querySelectorAll<HTMLElement>("img"))
      image.replaceWith(` ${imageEvidence(image)} `);
    return cleanedSpokenBlock(clone)?.text ?? "";
  };
  const rows = Array.from(table.querySelectorAll("tr")).filter(
    (row) => row.closest("table") === table,
  );
  const captionElement = table.querySelector("caption");
  const caption = captionElement ? cellText(captionElement) : "";
  const header = rows.find(
    (row) =>
      row.children.length > 0 &&
      Array.from(row.children).every((cell) => cell.tagName === "TH"),
  );
  const headers = header
    ? Array.from(header.children).map(
        (cell) => cellText(cell) || "Unlabelled column",
      )
    : [];
  const complex = Boolean(
    table.querySelector(
      '[rowspan]:not([rowspan="1"]), [colspan]:not([colspan="1"]), table',
    ),
  );
  const detail = rows
    .map((row) => {
      const cells = Array.from(row.children).filter((cell) =>
        /^(TH|TD)$/.test(cell.tagName),
      );
      if (row === header && cells.every((cell) => cell.tagName === "TH"))
        return `Column headings: ${headers.join("; ")}.`;
      return `${cells
        .map(
          (cell, i) =>
            `${complex ? `Cell ${i + 1}` : (headers[i] ?? `Column ${i + 1}`)}: ${cellText(cell) || "blank"}`,
        )
        .join("; ")}.`;
    })
    .join("\n");
  return `Table${caption ? `: ${caption}` : ""}. ${complex ? "This table has grouped or merged cells; the following is a row-by-row reading, not a complete account of its header relationships. " : ""}\n${detail}\nEnd of table.`;
}

/** Retain visual evidence before flattening, while keeping the original DOM untouched. */
export function narrationEntries(
  body: HTMLElement | null,
  paragraphs: HTMLElement[],
): NarrationEntry[] {
  if (!body)
    return paragraphs.flatMap((element, sourceIndex) => {
      const spoken = spokenBlock(element);
      return spoken ? [{ element, sourceIndex, spoken }] : [];
    });
  const numbered = new Map(paragraphs.map((el, i) => [el, i]));
  const candidates = Array.from(
    body.querySelectorAll<HTMLElement>("[data-para], table, img"),
  );
  let sourceIndex = 0;
  return candidates.flatMap((element): NarrationEntry[] => {
    const own = numbered.get(element);
    if (own !== undefined) sourceIndex = own;
    if (element.closest("[data-marginalia-ui]")) return [];
    if (element.tagName !== "TABLE" && element.closest("table")) return [];
    if (element.tagName === "TABLE" && element.parentElement?.closest("table"))
      return [];
    // Images inside a prose leaf are represented at their position in that leaf.
    if (
      element.tagName === "IMG" &&
      element.parentElement?.closest("[data-para]")
    )
      return [];
    let spoken: SpokenBlock | null;
    if (element.tagName === "TABLE")
      spoken = { text: tableEvidence(element), heading: false, kind: "table" };
    else if (element.tagName === "IMG")
      spoken = { text: imageEvidence(element), heading: false, kind: "image" };
    else if (element.tagName === "PRE" || isCodeOnly(element))
      spoken = {
        text: element.textContent ?? "",
        heading: false,
        kind: "code",
      };
    else {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const image of clone.querySelectorAll<HTMLElement>("img"))
        image.replaceWith(` ${imageEvidence(image)} `);
      spoken = spokenBlock(clone);
      if (spoken) {
        const item = element.closest("li");
        spoken.kind = spoken.heading ? "heading" : item ? "list" : "prose";
        if (item?.parentElement?.tagName === "OL") {
          const list = item.parentElement as HTMLOListElement;
          const siblings = Array.from(list.children).filter(
            (el) => el.tagName === "LI",
          );
          let number = list.hasAttribute("start")
            ? list.start
            : list.reversed
              ? siblings.length
              : 1;
          for (const sibling of siblings) {
            if (sibling.hasAttribute("value"))
              number = (sibling as HTMLLIElement).value;
            if (sibling === item) break;
            number += list.reversed ? -1 : 1;
          }
          spoken.text = `Step ${number}. ${spoken.text}`;
        }
      }
    }
    const tableIndices =
      element.tagName === "TABLE"
        ? Array.from(
            element.querySelectorAll<HTMLElement>("[data-para]"),
          ).flatMap((child) => {
            const index = numbered.get(child);
            return index === undefined ? [] : [index];
          })
        : [];
    return spoken?.text.trim()
      ? [
          {
            element,
            sourceIndex: tableIndices[0] ?? own ?? sourceIndex,
            ...(tableIndices.length
              ? { sourceEndIndex: tableIndices[tableIndices.length - 1] }
              : {}),
            spoken,
          },
        ]
      : [];
  });
}

/** What opens a listen from the top: "<title>. By <author>.", or just "<title>.". */
export function spokenTitle(title: string, author?: string | null): string {
  const named = title.replace(/\s+/g, " ").trim();
  const by = author?.replace(/\s+/g, " ").trim();
  if (!named) return by ? `By ${by}.` : "";
  const sentence = CLOSING_PUNCTUATION.test(named) ? named : `${named}.`;
  return by ? `${sentence} By ${by}.` : sentence;
}

function sentencesOf(text: string, lang: string): string[] {
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  } catch {
    // An unknown language tag still has sentences
    segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  }
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Splits one over-long sentence at the last comma or space before the limit. */
function splitLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = Math.max(window.lastIndexOf(","), window.lastIndexOf(" "));
    // The backend counts UTF-16 units like `.length`, so never cut an emoji in half
    const hardCut = isHighSurrogate(window.charCodeAt(max - 1)) ? max - 1 : max;
    const cut = at > 0 ? at + 1 : hardCut;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Sentences, with any sentence longer than `max` already split. */
function sentencePieces(text: string, lang: string, max: number): string[] {
  return sentencesOf(text, lang).flatMap((sentence) =>
    sentence.length > max ? splitLongSentence(sentence, max) : [sentence],
  );
}

function pack(pieces: string[], max: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length > max) {
      parts.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Rule 6: parts of at most `max` characters, split at sentence ends. */
export function splitSpoken(
  text: string,
  lang: string,
  max = MAX_CLIP_CHARS,
): string[] {
  if (text.length <= max) return text ? [text] : [];
  return pack(sentencePieces(text, lang, max), max);
}

/**
 * Cuts `text` so the head is at most `limit` UTF-16 units: at the last comma,
 * else the last space, else (never inside an emoji) at the limit.
 */
function cutAtLimit(text: string, limit: number): [string, string] {
  const comma = text.lastIndexOf(",", limit - 1);
  const space = text.lastIndexOf(" ", limit);
  const hard = isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit;
  const cut = comma > 0 ? comma + 1 : space > 0 ? space : hard;
  return [text.slice(0, cut), text.slice(cut)];
}

/**
 * The first block of a listen: a first part of at most `lead` units (D-TTS-023),
 * then the rest packed as usual. The first part is the leading sentences that
 * fit; when the first sentence alone is longer it is cut at its last comma,
 * else its last space. A clip's wait grows with its length, so a short first
 * part is what gets the voice going quickly. No text is dropped.
 */
export function splitLeading(
  text: string,
  lang: string,
  lead = LEAD_CHARS,
  max = MAX_CLIP_CHARS,
): string[] {
  if (text.length <= lead) return text ? [text] : [];
  let pieces = sentencePieces(text, lang, max);
  if (pieces[0].length > lead) {
    const [head, tail] = cutAtLimit(pieces[0], lead);
    pieces = [head, tail, ...pieces.slice(1)];
  }
  let taken = 1;
  let length = pieces[0].length;
  while (taken < pieces.length && length + pieces[taken].length <= lead) {
    length += pieces[taken].length;
    taken += 1;
  }
  const first = pieces.slice(0, taken).join("").trim();
  return [first, ...pack(pieces.slice(taken), max)].filter(Boolean);
}
