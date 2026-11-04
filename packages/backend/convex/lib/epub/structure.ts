import type { Element, Node } from "@xmldom/xmldom";
import { resolveEpubHref } from "./archive";
import type { EpubBlock, EpubResult, EpubSpineItem } from "./types";
import { elements, escapeHtml, parseEpubXml } from "./xml";

const allowed = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "hr",
  "aside",
  "sup",
  "sub",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "br",
  "a",
  "img",
]);
const discarded = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "svg",
  "math",
  "audio",
  "video",
  "canvas",
  "head",
  "nav",
]);
const containers = new Set([
  "body",
  "section",
  "article",
  "div",
  "main",
  "header",
  "footer",
]);
const blockTags = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "ul",
  "ol",
  "dl",
  "table",
  "figure",
  "hr",
  "aside",
  "pre",
]);

export function epubAnchor(spineIndex: number, id: string): string {
  return `epub-${spineIndex}-${encodeURIComponent(id)}`;
}

export function parseEpubSpineItem(
  bytes: Uint8Array,
  href: string,
  spineIndex: number,
): EpubResult<EpubSpineItem> {
  const parsed = parseEpubXml(bytes);
  if (!parsed.ok) return parsed;
  const body = elements(parsed.value, "body")[0];
  if (!body) return { ok: false, reason: "unreadable" };
  const blocks: EpubBlock[] = [];
  let text = "";
  let title = "";
  const append = (html: string, plain: string, heading: boolean) => {
    const content = plain
      .replace(/[^\S\n]+/gu, " ")
      .replace(/ *\n */gu, "\n")
      .trim();
    if (!html.trim()) return;
    if (blocks.length) text += "\n\n";
    const start = text.length;
    text += content;
    blocks.push({ html, text: content, start, end: text.length });
    if (heading && !title) title = content;
  };
  const render = (node: Node): { html: string; text: string } => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const value = (node.nodeValue ?? "").replace(/\s+/gu, " ");
      return { html: escapeHtml(value), text: value };
    }
    if (node.nodeType !== 1) return { html: "", text: "" };
    const element = isElement(node) ? node : undefined;
    if (!element) return { html: "", text: "" };
    const tag = (element.localName ?? element.tagName).toLowerCase();
    if (
      discarded.has(tag) ||
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true"
    )
      return { html: "", text: "" };
    const children = Array.from(element.childNodes).map(render);
    const html = children.map((child) => child.html).join("");
    const plain = children.map((child) => child.text).join("");
    const originalId = element.getAttribute("id");
    const id = originalId
      ? ` id="${escapeHtml(epubAnchor(spineIndex, originalId))}"`
      : "";
    if (!allowed.has(tag))
      return { html: `${id ? `<span${id}></span>` : ""}${html}`, text: plain };
    if (tag === "img") {
      const source = resolveEpubHref(href, element.getAttribute("src") ?? "");
      const alt = element.getAttribute("alt") ?? "";
      return {
        html:
          source && !source.includes("#")
            ? `<img${id} data-epub-image="${encodeURIComponent(source)}" alt="${escapeHtml(alt)}">`
            : escapeHtml(alt),
        text: alt,
      };
    }
    if (tag === "br") return { html: "<br>", text: "\n" };
    if (tag === "hr") return { html: `<hr${id}>`, text: "\n" };
    if (tag === "a") {
      const raw = element.getAttribute("href") ?? "";
      const target = resolveEpubHref(href, raw);
      let link = target
        ? ` data-epub-href="${encodeURIComponent(target)}"`
        : "";
      if (
        !target &&
        /^(https?:\/\/|mailto:)/iu.test(raw) &&
        !/[\p{Cc}\s]/u.test(raw)
      )
        link = ` href="${escapeHtml(raw)}"`;
      return { html: `<a${id}${link}>${html}</a>`, text: plain };
    }
    const numeric = ["td", "th"].includes(tag)
      ? ["colspan", "rowspan"]
          .map((name) => {
            const value = element.getAttribute(name) ?? "";
            return /^\d{1,2}$/u.test(value) ? ` ${name}="${value}"` : "";
          })
          .join("")
      : "";
    const separator =
      blockTags.has(tag) || ["li", "tr", "dt", "dd"].includes(tag)
        ? "\n"
        : tag === "td" || tag === "th"
          ? " "
          : "";
    return {
      html: `<${tag}${id}${numeric}>${html}</${tag}>`,
      text: `${plain}${separator}`,
    };
  };
  const visit = (node: Node) => {
    const element = isElement(node) ? node : undefined;
    const tag = element
      ? (element.localName ?? element.tagName).toLowerCase()
      : "";
    if (
      element &&
      (discarded.has(tag) ||
        element.hasAttribute("hidden") ||
        element.getAttribute("aria-hidden") === "true")
    )
      return;
    if (element && containers.has(tag)) {
      const id = element.getAttribute("id");
      if (id)
        append(
          `<span id="${escapeHtml(epubAnchor(spineIndex, id))}"></span>`,
          "",
          false,
        );
      let inlineHtml = "";
      let inlineText = "";
      const flush = () => {
        if (inlineText.trim() || /<(?:img|hr|span)\b| id="/u.test(inlineHtml))
          append(`<p>${inlineHtml}</p>`, inlineText, false);
        inlineHtml = "";
        inlineText = "";
      };
      for (const child of Array.from(element.childNodes)) {
        const tag = isElement(child)
          ? (child.localName ?? child.tagName).toLowerCase()
          : "";
        if (blockTags.has(tag) || containers.has(tag)) {
          flush();
          visit(child);
        } else {
          const rendered = render(child);
          inlineHtml += rendered.html;
          inlineText += rendered.text;
        }
      }
      flush();
      return;
    }
    const rendered = render(node);
    if (
      !rendered.text.trim() &&
      !/<(?:img|hr|span)\b| id="/u.test(rendered.html)
    )
      return;
    const block = element && blockTags.has(tag);
    append(
      block ? rendered.html : `<p>${rendered.html}</p>`,
      rendered.text,
      /^h[1-6]$/u.test(tag),
    );
  };
  visit(body);
  return {
    ok: true,
    value: {
      href,
      xhtml: new TextDecoder().decode(bytes),
      title: title || `Part ${spineIndex + 1}`,
      text,
      blocks,
    },
  };
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}
