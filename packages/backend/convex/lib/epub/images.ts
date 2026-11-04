import { escapeHtml } from "./xml";

export function rasterType(bytes: Uint8Array, declared: string): string | null {
  if (declared === "image/png" && completePng(bytes)) return declared;
  if (declared === "image/jpeg" && completeJpeg(bytes)) return declared;
  if (declared === "image/gif" && completeGif(bytes)) return declared;
  if (declared === "image/webp" && completeWebp(bytes)) return declared;
  return null;
}

function completePng(bytes: Uint8Array): boolean {
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let header = false;
  let dataBytes = 0;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    if (length > bytes.length - at - 12) return false;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!header) {
      if (
        type !== "IHDR" ||
        length !== 13 ||
        !view.getUint32(at + 8) ||
        !view.getUint32(at + 12) ||
        bytes[at + 18] !== 0 ||
        bytes[at + 19] !== 0 ||
        (bytes[at + 20] !== 0 && bytes[at + 20] !== 1)
      )
        return false;
      const depth = bytes[at + 16];
      const color = bytes[at + 17];
      if (
        depth === undefined ||
        color === undefined ||
        !(
          color === 0
            ? [1, 2, 4, 8, 16]
            : color === 3
              ? [1, 2, 4, 8]
              : [2, 4, 6].includes(color)
                ? [8, 16]
                : []
        ).includes(depth)
      )
        return false;
      header = true;
    } else if (type === "IHDR") return false;
    if (type === "IDAT") dataBytes += length;
    at += length + 12;
    if (type === "IEND")
      return length === 0 && dataBytes >= 9 && at === bytes.length;
  }
  return false;
}

function completeJpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 255 || bytes[1] !== 216) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  let frame = false;
  let scan = false;
  while (at < bytes.length) {
    if (bytes[at] !== 255) return false;
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217) return frame && scan && at === bytes.length;
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 216 ||
      (marker >= 208 && marker <= 215) ||
      at + 2 > bytes.length
    )
      return false;
    const length = view.getUint16(at);
    if (length < 2 || length > bytes.length - at) return false;
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      const components = bytes[at + 7];
      if (
        length < 11 ||
        !components ||
        length !== 8 + components * 3 ||
        !view.getUint16(at + 3) ||
        !view.getUint16(at + 5)
      )
        return false;
      frame = true;
    }
    if (marker !== 218) {
      at += length;
      continue;
    }
    const components = bytes[at + 2];
    if (!frame || !components || length !== 6 + components * 2) return false;
    at += length;
    let payload = 0;
    while (at < bytes.length) {
      if (bytes[at] !== 255) {
        payload++;
        at++;
      } else if (
        bytes[at + 1] === 0 ||
        ((bytes[at + 1] ?? 0) >= 208 && (bytes[at + 1] ?? 0) <= 215)
      ) {
        payload++;
        at += 2;
      } else break;
    }
    if (!payload) return false;
    scan = true;
  }
  return false;
}

function completeGif(bytes: Uint8Array): boolean {
  if (
    bytes.length < 14 ||
    !["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)))
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!view.getUint16(6, true) || !view.getUint16(8, true)) return false;
  const packed = bytes[10] ?? 0;
  let at = 13 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  let image = false;
  const subBlocks = () => {
    let payload = 0;
    while (at < bytes.length) {
      const length = bytes[at++];
      if (length === undefined || length > bytes.length - at) return null;
      if (length === 0) return payload;
      payload += length;
      at += length;
    }
    return null;
  };
  while (at < bytes.length) {
    const marker = bytes[at++];
    if (marker === 59) return image && at === bytes.length;
    if (marker === 33) {
      if (at >= bytes.length) return false;
      at++;
      if (subBlocks() === null) return false;
      continue;
    }
    if (
      marker !== 44 ||
      at + 9 > bytes.length ||
      !view.getUint16(at + 4, true) ||
      !view.getUint16(at + 6, true)
    )
      return false;
    const local = bytes[at + 8] ?? 0;
    at += 9 + (local & 128 ? 3 * 2 ** ((local & 7) + 1) : 0);
    const codeSize = bytes[at++];
    if (codeSize === undefined || codeSize < 2 || codeSize > 8) return false;
    const payload = subBlocks();
    if (payload === null || payload < 2) return false;
    image = true;
  }
  return false;
}

function completeWebp(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return false;
  return webpPayload(bytes, 12, bytes.length, true);
}

function webpPayload(
  bytes: Uint8Array,
  start: number,
  end: number,
  animation: boolean,
): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let image = false;
  let at = start;
  while (at + 8 <= end) {
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    const length = view.getUint32(at + 4, true);
    at += 8;
    if (length > end - at) return false;
    if (type === "VP8 ") {
      if (
        length <= 10 ||
        (bytes[at] ?? 1) & 1 ||
        bytes[at + 3] !== 157 ||
        bytes[at + 4] !== 1 ||
        bytes[at + 5] !== 42 ||
        !(view.getUint16(at + 6, true) & 16383) ||
        !(view.getUint16(at + 8, true) & 16383)
      )
        return false;
      const partition =
        ((bytes[at] ?? 0) |
          ((bytes[at + 1] ?? 0) << 8) |
          ((bytes[at + 2] ?? 0) << 16)) >>>
        5;
      if (!partition || partition > length - 10) return false;
      image = true;
    } else if (type === "ANMF") {
      if (
        !animation ||
        length <= 24 ||
        !webpPayload(bytes, at + 16, at + length, false)
      )
        return false;
      image = true;
    } else if (type === "VP8L") {
      if (length <= 5 || bytes[at] !== 47 || (bytes[at + 4] ?? 255) >>> 5 !== 0)
        return false;
      image = true;
    }
    at += length + (length & 1);
  }
  return image && at === end;
}

export function replaceEpubImages(
  html: string,
  urls: ReadonlyMap<string, string>,
): string {
  return html.replace(
    /<img(?: id="[^"]*")? data-epub-image="([^"]*)" alt="([^"]*)">/gu,
    (tag: string, encoded: string, alt: string) => {
      const url = urls.get(decodeURIComponent(encoded));
      return url
        ? tag.replace(
            `data-epub-image="${encoded}"`,
            `src="${escapeHtml(url)}"`,
          )
        : alt;
    },
  );
}
