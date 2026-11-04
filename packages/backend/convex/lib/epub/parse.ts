import { openEpubArchive } from "./archive";
import { parseEpubOutline } from "./outline";
import { checkEpubEncryption, parseEpubPackage } from "./package";
import { parseEpubSpineItem } from "./structure";
import type { EpubResult, EpubSpineItem, ParsedEpub } from "./types";
import { epubUnits } from "./units";

export function parseEpub(
  input: Uint8Array | ReadonlyMap<string, Uint8Array>,
): EpubResult<ParsedEpub> {
  const opened = openEpubArchive(input);
  if (!opened.ok) return opened;
  const files = opened.value;
  const parsed = parseEpubPackage(files);
  if (!parsed.ok) return parsed;
  const book = parsed.value;
  const encryption = checkEpubEncryption(files, book.manifest);
  if (!encryption.ok) return encryption;
  const outline = parseEpubOutline(files, book);
  if (!outline.ok) return outline;
  const spine: EpubSpineItem[] = [];
  for (const [index, item] of book.spine.entries()) {
    const bytes = files.get(item.href);
    if (!bytes) return { ok: false, reason: "not_epub" };
    const parsed = parseEpubSpineItem(bytes, item.href, index);
    if (!parsed.ok) return parsed;
    const named = outline.value.find(
      (entry) => entry.href.split("#")[0] === item.href,
    );
    spine.push({ ...parsed.value, title: named?.title ?? parsed.value.title });
  }
  const units = epubUnits(spine);
  if (!units.ok) return units;
  const images: { href: string; mediaType: string; bytes: Uint8Array }[] = [];
  const imageTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
  ]);
  const seen = new Set<string>();
  for (const item of book.manifest) {
    const bytes = files.get(item.href);
    if (bytes && imageTypes.has(item.mediaType) && !seen.has(item.href)) {
      images.push({ href: item.href, mediaType: item.mediaType, bytes });
      seen.add(item.href);
    }
  }
  return {
    ok: true,
    value: {
      metadata: {
        title: book.title,
        creators: book.creators,
        identifier: book.identifier,
        language: book.language,
      },
      manifest: book.manifest,
      images,
      spine,
      outline: outline.value.length
        ? outline.value
        : spine.map((item) => ({
            title: item.title,
            href: item.href,
            depth: 0,
          })),
      units: units.value,
    },
  };
}
