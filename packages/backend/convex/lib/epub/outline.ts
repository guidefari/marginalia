import type { Element } from "@xmldom/xmldom";
import { resolveEpubHref } from "./archive";
import type { EpubOutlineEntry, EpubPackage, EpubResult } from "./types";
import { childElements, elements, parseEpubXml, xmlText } from "./xml";

export function parseEpubOutline(
  files: ReadonlyMap<string, Uint8Array>,
  book: EpubPackage,
): EpubResult<readonly EpubOutlineEntry[]> {
  const nav = book.manifest.find((item) => item.properties.includes("nav"));
  if (nav) {
    const parsed = parseEpubXml(files.get(nav.href));
    if (!parsed.ok) return parsed;
    const toc = elements(parsed.value, "nav").find((node) =>
      (node.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "")
        .split(/\s+/u)
        .includes("toc"),
    );
    if (toc) {
      const entries: EpubOutlineEntry[] = [];
      const visit = (node: Element, depth: number) => {
        if (node.localName === "a") {
          const href = resolveEpubHref(
            nav.href,
            node.getAttribute("href") ?? "",
          );
          const title = xmlText(node);
          if (
            href &&
            title &&
            book.spine.some((item) => item.href === href.split("#")[0])
          )
            entries.push({ title, href, depth: Math.max(0, depth - 1) });
        }
        for (const child of childElements(node))
          visit(child, depth + (child.localName === "ol" ? 1 : 0));
      };
      visit(toc, 0);
      if (entries.length) return { ok: true, value: entries };
    }
  }
  const ncx =
    book.manifest.find((item) => item.id === book.ncxId) ??
    book.manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");
  if (!ncx) return { ok: true, value: [] };
  const parsed = parseEpubXml(files.get(ncx.href));
  if (!parsed.ok) return parsed;
  const entries: EpubOutlineEntry[] = [];
  const visit = (node: Element, depth: number) => {
    if (node.localName === "navPoint") {
      const href = resolveEpubHref(
        ncx.href,
        elements(node, "content")[0]?.getAttribute("src") ?? "",
      );
      const title = xmlText(elements(node, "navLabel")[0]);
      if (
        href &&
        title &&
        book.spine.some((item) => item.href === href.split("#")[0])
      )
        entries.push({ title, href, depth });
    }
    for (const child of childElements(node))
      visit(child, depth + (node.localName === "navPoint" ? 1 : 0));
  };
  const root = parsed.value.documentElement;
  if (root) visit(root, 0);
  return { ok: true, value: entries };
}
