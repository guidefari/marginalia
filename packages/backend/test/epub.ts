import { strToU8, zipSync } from "fflate";

const decoded = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const lossyWebp = decoded(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAgA0JaQAA3AA/vtdAAA=",
);

function webpChunk(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(8 + payload.length + (payload.length & 1));
  bytes.set(strToU8(type));
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
}

function animatedWebp() {
  const header = new Uint8Array(10);
  header[0] = 2;
  header[4] = 1;
  header[7] = 1;
  const frame = new Uint8Array(16);
  frame[6] = 1;
  frame[9] = 1;
  const body = Uint8Array.from([
    ...strToU8("WEBP"),
    ...webpChunk("VP8X", header),
    ...webpChunk("ANIM", new Uint8Array(6)),
    ...webpChunk(
      "ANMF",
      Uint8Array.from([...frame, ...lossyWebp.subarray(12)]),
    ),
  ]);
  const bytes = new Uint8Array(8 + body.length);
  bytes.set(strToU8("RIFF"));
  new DataView(bytes.buffer).setUint32(4, body.length, true);
  bytes.set(body, 8);
  return bytes;
}

export const tinyRasters = [
  {
    mediaType: "image/png",
    bytes: decoded(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8+/cvAwMDCwMYAAAjzAL962fXNwAAAABJRU5ErkJggg==",
    ),
  },
  {
    mediaType: "image/jpeg",
    bytes: decoded(
      "/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEsAAQEAAAAAAAAAAAAAAAAAAAAHAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAAgACAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8Av4AP/9k=",
    ),
  },
  {
    mediaType: "image/gif",
    bytes: Uint8Array.from([
      71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44,
      0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
    ]),
  },
  {
    mediaType: "image/webp",
    bytes: lossyWebp,
  },
  {
    mediaType: "image/webp",
    bytes: decoded("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQ/va3v/+BiOh/AAA="),
  },
  {
    mediaType: "image/webp",
    bytes: animatedWebp(),
  },
];

export function makeEpub(
  options: {
    body?: string;
    image?: Uint8Array;
    imageMediaType?: string;
    protected?: boolean;
  } = {},
) {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OPS/book.opf": strToU8(
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Generated field guide</dc:title><dc:creator>Fixture author</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="chart.png" media-type="${options.imageMediaType ?? "image/png"}"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
    ),
    "OPS/chapter.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body>${options.body ?? '<h1>Beginning</h1><p>A generated public fixture.</p><figure><img src="chart.png" alt="A &amp; B"/><figcaption>A chart.</figcaption></figure><img src="missing.png" alt="&lt;missing&gt;"/><img src="https://publisher.invalid/track.png" alt="Remote"/>'}</body></html>`,
    ),
    "OPS/chart.png":
      options.image ??
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8+/cvAwMDCwMYAAAjzAL962fXNwAAAABJRU5ErkJggg==",
        ),
        (char) => char.charCodeAt(0),
      ),
  };
  if (options.protected)
    files["META-INF/encryption.xml"] = strToU8(
      '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="OPS/chapter.xhtml"/></CipherData></EncryptedData></encryption>',
    );
  return zipSync(files);
}
