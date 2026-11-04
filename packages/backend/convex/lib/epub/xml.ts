import {
  DOMParser,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import type { EpubResult } from "./types";

export function parseEpubXml(
  bytes: Uint8Array | undefined,
): EpubResult<Document> {
  if (!bytes) return { ok: false, reason: "not_epub" };
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/iu.test(source))
      return { ok: false, reason: "unreadable" };
    let invalid = false;
    const doc = new DOMParser({
      onError: () => {
        invalid = true;
      },
    }).parseFromString(source, "application/xml");
    if (invalid || !doc.documentElement)
      return { ok: false, reason: "unreadable" };
    const pending: { node: Node; depth: number }[] = [
      { node: doc.documentElement, depth: 0 },
    ];
    let count = 0;
    while (pending.length) {
      const entry = pending.pop();
      if (!entry) break;
      if (entry.depth > 128 || ++count > 100_000)
        return { ok: false, reason: "too_long" };
      for (let child = entry.node.firstChild; child; child = child.nextSibling)
        pending.push({ node: child, depth: entry.depth + 1 });
    }
    return { ok: true, value: doc };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export function elements(
  node: Document | Element,
  localName: string,
): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

export function childElements(node: Node): Element[] {
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === 1,
  );
}

export function xmlText(node: Node | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
