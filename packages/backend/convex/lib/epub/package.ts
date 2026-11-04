import { EPUB_LIMITS, resolveEpubHref } from "./archive";
import type { EpubPackage, EpubResult, ManifestItem } from "./types";
import { elements, parseEpubXml, xmlText } from "./xml";

export function parseEpubPackage(
  files: ReadonlyMap<string, Uint8Array>,
): EpubResult<EpubPackage> {
  const container = parseEpubXml(files.get("META-INF/container.xml"));
  if (!container.ok) return container;
  const rootfile = elements(container.value, "rootfile").find(
    (node) =>
      node.getAttribute("media-type")?.toLowerCase() ===
      "application/oebps-package+xml",
  );
  const path = resolveEpubHref("", rootfile?.getAttribute("full-path") ?? "");
  if (!path || path.includes("#")) return { ok: false, reason: "not_epub" };
  const parsed = parseEpubXml(files.get(path));
  if (!parsed.ok) return parsed;
  const root = parsed.value.documentElement;
  if (!root || root.localName !== "package")
    return { ok: false, reason: "not_epub" };
  const metadata = elements(root, "metadata")[0];
  const manifestNode = elements(root, "manifest")[0];
  const spineNode = elements(root, "spine")[0];
  if (!metadata || !manifestNode || !spineNode)
    return { ok: false, reason: "not_epub" };
  const manifest: ManifestItem[] = [];
  const itemsById = new Map<string, ManifestItem>();
  for (const node of elements(manifestNode, "item")) {
    const id = node.getAttribute("id");
    const href = resolveEpubHref(path, node.getAttribute("href") ?? "");
    const mediaType = node.getAttribute("media-type")?.toLowerCase();
    if (!id || itemsById.has(id) || !href || href.includes("#") || !mediaType)
      return { ok: false, reason: "not_epub" };
    const item: ManifestItem = {
      id,
      href,
      mediaType,
      properties: (node.getAttribute("properties") ?? "")
        .split(/\s+/u)
        .filter((value) => value.length > 0),
    };
    manifest.push(item);
    itemsById.set(id, item);
  }
  const spine: ManifestItem[] = [];
  const itemrefs = elements(spineNode, "itemref");
  if (itemrefs.length > EPUB_LIMITS.spineItems)
    return { ok: false, reason: "too_long" };
  for (const ref of itemrefs) {
    const item = itemsById.get(ref.getAttribute("idref") ?? "");
    if (!item || !files.has(item.href))
      return { ok: false, reason: "not_epub" };
    if (item.mediaType !== "application/xhtml+xml")
      return { ok: false, reason: "unreadable" };
    spine.push(item);
  }
  const dcNamespace = "http://purl.org/dc/elements/1.1/";
  const identifiers = Array.from(
    metadata.getElementsByTagNameNS(dcNamespace, "identifier"),
  );
  const identifier = identifiers.find(
    (node) =>
      node.getAttribute("id") === root.getAttribute("unique-identifier"),
  );
  return {
    ok: true,
    value: {
      title:
        xmlText(
          metadata.getElementsByTagNameNS(dcNamespace, "title").item(0) ??
            undefined,
        ) || "Untitled book",
      creators: Array.from(
        metadata.getElementsByTagNameNS(dcNamespace, "creator"),
      )
        .map(xmlText)
        .filter((value) => value.length > 0),
      identifier: xmlText(identifier) || undefined,
      language:
        xmlText(
          metadata.getElementsByTagNameNS(dcNamespace, "language").item(0) ??
            undefined,
        ) || undefined,
      manifest,
      spine,
      ncxId: spineNode.getAttribute("toc") || undefined,
    },
  };
}

export function checkEpubEncryption(
  files: ReadonlyMap<string, Uint8Array>,
  manifest: readonly ManifestItem[],
): EpubResult<null> {
  const bytes = files.get("META-INF/encryption.xml");
  if (!bytes) return { ok: true, value: null };
  const parsed = parseEpubXml(bytes);
  if (!parsed.ok) return parsed;
  const encrypted = elements(parsed.value, "EncryptedData");
  const fontAlgorithms = new Set([
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
  ]);
  for (const entry of encrypted) {
    const method =
      elements(entry, "EncryptionMethod")[0]?.getAttribute("Algorithm") ?? "";
    if (!fontAlgorithms.has(method)) return { ok: false, reason: "protected" };
    const target = resolveEpubHref(
      "",
      elements(entry, "CipherReference")[0]?.getAttribute("URI") ?? "",
    );
    const item = manifest.find((item) => item.href === target);
    if (
      !item ||
      !/^(?:font\/(?:otf|ttf|woff2?)|application\/(?:vnd\.ms-opentype|font-(?:sfnt|woff)|x-font-(?:ttf|opentype)))$/u.test(
        item.mediaType,
      )
    )
      return { ok: false, reason: "protected" };
  }
  if (!encrypted.length && elements(parsed.value, "EncryptionMethod").length)
    return { ok: false, reason: "protected" };
  return { ok: true, value: null };
}
