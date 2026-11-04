import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EPUB_LIMITS } from "./archive";
import { parseEpub } from "./parse";

function fixture({
  bodies = ["<h1>First chapter</h1><p>A quiet beginning.</p>"],
  nav = "",
  ncx = "",
  encryption = "",
  extra = new Map<string, string | Uint8Array>(),
}: {
  bodies?: readonly string[];
  nav?: string;
  ncx?: string;
  encryption?: string;
  extra?: ReadonlyMap<string, string | Uint8Array>;
} = {}) {
  const files = new Map<string, Uint8Array>();
  files.set("mimetype", strToU8("application/epub+zip"));
  files.set(
    "META-INF/container.xml",
    strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  );
  files.set(
    "OPS/package.opf",
    strToU8(
      `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="edition" version="${ncx ? "2.0" : "3.0"}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A &amp; B</dc:title><dc:creator>First Author</dc:creator><dc:creator>Second Author</dc:creator><dc:identifier id="other">not-this</dc:identifier><dc:identifier id="edition">urn:fixture:edition</dc:identifier><dc:language>en</dc:language></metadata><manifest>${bodies.map((_, index) => `<item id="chapter-${index}" href="text/chapter-${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ""}${ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ""}<item id="image" href="images/chart.png" media-type="image/png"/><item id="font" href="fonts/book.otf" media-type="font/otf"/></manifest><spine${ncx ? ' toc="ncx"' : ""}>${bodies.map((_, index) => `<itemref idref="chapter-${index}"/>`).join("")}</spine></package>`,
    ),
  );
  for (const [index, body] of bodies.entries())
    files.set(
      `OPS/text/chapter-${index}.xhtml`,
      strToU8(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignored title</title></head><body>${body}</body></html>`,
      ),
    );
  if (nav)
    files.set(
      "OPS/nav.xhtml",
      strToU8(
        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${nav}</body></html>`,
      ),
    );
  if (ncx) files.set("OPS/toc.ncx", strToU8(ncx));
  if (encryption) files.set("META-INF/encryption.xml", strToU8(encryption));
  for (const [path, data] of extra)
    files.set(path, typeof data === "string" ? strToU8(data) : data);
  return files;
}

function archive(files: ReadonlyMap<string, Uint8Array>) {
  return zipSync(Object.fromEntries(files), { level: 6 });
}

function parsed(files = fixture()) {
  const result = parseEpub(archive(files));
  if (!result.ok) throw new Error(`Fixture refused: ${result.reason}`);
  return result.value;
}

describe("EPUB metadata and outline", () => {
  it("reads the declared edition identifier, creators and spine from original bytes", () => {
    const bytes = archive(fixture());
    const before = bytes.slice();
    const result = parseEpub(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metadata).toEqual({
      title: "A & B",
      creators: ["First Author", "Second Author"],
      identifier: "urn:fixture:edition",
      language: "en",
    });
    expect(result.value.outline).toEqual([
      { title: "First chapter", href: "OPS/text/chapter-0.xhtml", depth: 0 },
    ]);
    expect(result.value.spine[0]?.xhtml).toContain("A quiet beginning.");
    expect(bytes).toEqual(before);
  });

  it("accepts an in-memory unpacked directory with the same result as its ZIP", () => {
    const files = fixture();
    expect(parseEpub(files)).toEqual(parseEpub(archive(files)));
  });

  it("uses nested EPUB 3 navigation before NCX and filters non-spine destinations", () => {
    const book = parsed(
      fixture({
        bodies: [
          "<h1>One</h1><p>Start.</p>",
          '<h1 id="detail">Two</h1><p>Continue.</p>',
        ],
        nav: '<nav epub:type="toc"><ol><li><a href="text/chapter-0.xhtml">Opening</a><ol><li><a href="text/chapter-1.xhtml#detail">Detail</a></li></ol></li><li><a href="https://example.invalid">Offsite</a></li></ol></nav>',
        ncx: '<ncx><navMap><navPoint><navLabel><text>Wrong source</text></navLabel><content src="text/chapter-0.xhtml"/></navPoint></navMap></ncx>',
      }),
    );
    expect(book.outline).toEqual([
      { title: "Opening", href: "OPS/text/chapter-0.xhtml", depth: 0 },
      { title: "Detail", href: "OPS/text/chapter-1.xhtml#detail", depth: 1 },
    ]);
  });

  it("reads EPUB 2 NCX navigation and falls back from a nav without a toc", () => {
    const book = parsed(
      fixture({
        nav: '<nav epub:type="landmarks"/>',
        ncx: '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>From NCX</text></navLabel><content src="text/chapter-0.xhtml"/><navPoint><navLabel><text>Nested</text></navLabel><content src="text/chapter-0.xhtml#end"/></navPoint></navPoint></navMap></ncx>',
      }),
    );
    expect(book.outline.map((entry) => [entry.title, entry.depth])).toEqual([
      ["From NCX", 0],
      ["Nested", 1],
    ]);
  });

  it("does not lose spine order when filenames sort differently", () => {
    const files = fixture({
      bodies: ["<h1>Zebra</h1><p>First.</p>", "<h1>Apple</h1><p>Second.</p>"],
    });
    const packageBytes = files.get("OPS/package.opf");
    if (!packageBytes) throw new Error("Missing fixture package");
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(packageBytes)
          .replace(
            '<itemref idref="chapter-0"/><itemref idref="chapter-1"/>',
            '<itemref idref="chapter-1"/><itemref idref="chapter-0"/>',
          ),
      ),
    );
    expect(parsed(files).spine.map((item) => item.title)).toEqual([
      "Apple",
      "Zebra",
    ]);
  });
});

describe("EPUB reading content", () => {
  it("keeps structure and image references without executing or loading publication resources", () => {
    const book = parsed(
      fixture({
        bodies: [
          '<section id="start"><h1 onclick="evil()">Structure</h1><p style="color:red" class="publisher">A <em>quiet</em> &amp; <strong>clear</strong> sentence.<script>evil()</script></p><blockquote><p>A quotation.</p></blockquote><ul><li>One</li><li>Two</li></ul><table><tr><th>Head</th><td colspan="2">Cell</td></tr></table><figure><img src="../images/chart.png" alt="Chart"/><figcaption>A figure.</figcaption></figure><p>Verse<br/>Another line<sup>1</sup><sub>2</sub></p><hr/><aside>A note.</aside><form><p>Not reading text.</p></form><iframe src="https://tracking.invalid"/><svg><script>evil()</script></svg><div hidden="hidden"><p>Hidden text.</p></div></section>',
        ],
        extra: new Map([
          ["OPS/images/chart.png", new Uint8Array([137, 80, 78, 71])],
        ]),
      }),
    );
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(html).toContain("<blockquote><p>A quotation.</p></blockquote>");
    expect(html).toContain('<td colspan="2">Cell</td>');
    expect(html).toContain(
      '<img data-epub-image="OPS%2Fimages%2Fchart.png" alt="Chart">',
    );
    expect(html).toContain("Verse<br>Another line<sup>1</sup><sub>2</sub>");
    expect(html).toContain("<aside>A note.</aside>");
    expect(html).not.toMatch(
      /script|onclick|style=|class=|iframe|svg|form|src=|Hidden text|Not reading text/u,
    );
    expect(book.images).toEqual([
      {
        href: "OPS/images/chart.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
    ]);
  });

  it("drops unsafe links and remote images, and escapes literal markup", () => {
    const html = parsed(
      fixture({
        bodies: [
          '<p>&lt;script&gt;literal&lt;/script&gt; <a href="javascript:evil()">bad</a><a href="data:text/html,evil">bad too</a><a href="https://example.invalid/path?a=1&amp;b=2">safe</a><img src="https://tracking.invalid/pixel" alt="Remote figure"/></p>',
        ],
      }),
    ).units[0]?.contentHtml;
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;");
    expect(html).toContain(
      '<a href="https://example.invalid/path?a=1&amp;b=2">safe</a>',
    );
    expect(html).not.toMatch(/javascript:|data:|tracking\.invalid|src=/u);
    expect(html).toContain("Remote figure");
  });

  it("keeps inline runs together rather than turning emphasis into separate paragraphs", () => {
    const unit = parsed(
      fixture({
        bodies: ["Before <em>emphasis</em> after.<p>Next paragraph.</p>"],
      }),
    ).units[0];
    expect(unit?.contentHtml).toBe(
      "<p>Before <em>emphasis</em> after.</p><p>Next paragraph.</p>",
    );
    expect(unit?.content).toBe("Before emphasis after.\n\nNext paragraph.");
  });

  it("rewrites internal references after splitting, including fragments in later units", () => {
    const paragraph = "word ".repeat(2100).trim();
    const book = parsed(
      fixture({
        bodies: [
          `<h1>Long</h1><p><a href="#end">Jump</a></p><p>${paragraph}</p><p id="end">${paragraph}</p><p><a href="chapter-1.xhtml">Next chapter</a></p>`,
          "<h1>Last</h1><p>The end.</p>",
        ],
      }),
    );
    expect(book.units).toHaveLength(3);
    expect(book.units[0]?.contentHtml).toContain('href="?unit=1#epub-0-end"');
    expect(book.units[1]?.contentHtml).toContain('href="?unit=2"');
    expect(book.units[1]?.contentHtml).toContain('id="epub-0-end"');
    expect(
      book.units.every((unit) => unit.wordCount <= EPUB_LIMITS.unitWords),
    ).toBe(true);
  });

  it("merges short front matter into its neighbour with ranges for both spine items", () => {
    const book = parsed(
      fixture({
        bodies: [
          "<p>For the reader.</p>",
          `<h1>Chapter</h1><p>${"word ".repeat(150)}</p>`,
        ],
      }),
    );
    expect(book.units).toHaveLength(1);
    expect(book.units[0]?.title).toBe("Chapter");
    expect(book.units[0]?.sourceSpans.map((span) => span.spineIndex)).toEqual([
      0, 1,
    ]);
    expect(book.units[0]?.content).toContain("For the reader.");
  });

  it("keeps source ranges in UTF-16 text coordinates without losing split paragraphs", () => {
    const paragraphs = Array.from(
      { length: 8 },
      (_, index) => `<p>${index} café 😀 ${"word ".repeat(800)}</p>`,
    );
    const book = parsed(
      fixture({ bodies: [`<h1>Ranges</h1>${paragraphs.join("")}`] }),
    );
    const spans = book.units.flatMap((unit) => unit.sourceSpans);
    expect(spans[0]?.start).toBe(0);
    expect(spans.at(-1)?.end).toBe(book.spine[0]?.text.length);
    for (const unit of book.units) {
      expect(
        unit.sourceSpans
          .map((span) =>
            book.spine[span.spineIndex]?.text.slice(span.start, span.end),
          )
          .join("\n\n"),
      ).toBe(unit.content);
      expect(
        new TextEncoder().encode(unit.content + unit.contentHtml).byteLength,
      ).toBeLessThanOrEqual(EPUB_LIMITS.unitBytes);
    }
    expect(book.units.map((unit) => unit.content).join("\n\n")).toBe(
      book.spine[0]?.text,
    );
  });

  it("leaves a missing or malformed fragment inert instead of guessing a destination", () => {
    const html = parsed(
      fixture({
        bodies: [
          '<p><a href="#missing">Missing</a><a href="#%ZZ">Malformed</a></p>',
        ],
      }),
    ).units[0]?.contentHtml;
    expect(html).not.toContain("href=");
  });

  it("keeps source ranges exact when empty anchors precede reading text", () => {
    const book = parsed(
      fixture({
        bodies: [
          '<section id="chapter"><p><a id="start"/></p><h1>Chapter</h1><p>Reading text. <a href="#start">Back</a></p><hr/></section>',
        ],
      }),
    );
    expect(book.units[0]?.contentHtml).toContain('id="epub-0-start"');
    expect(book.units[0]?.contentHtml).toContain('href="?unit=0#epub-0-start"');
    for (const unit of book.units) {
      const source = unit.sourceSpans
        .map((span) =>
          book.spine[span.spineIndex]?.text.slice(span.start, span.end),
        )
        .join("\n\n");
      expect(unit.content).toBe(source);
    }
  });
});

describe("EPUB refusals", () => {
  it("refuses a ZIP without the EPUB container or package", () => {
    expect(
      parseEpub(archive(new Map([["readme.txt", strToU8("not a book")]]))),
    ).toEqual({ ok: false, reason: "not_epub" });
    const files = fixture();
    files.delete("OPS/package.opf");
    expect(parseEpub(files)).toEqual({ ok: false, reason: "not_epub" });
  });

  it("refuses malformed bytes and XML without exposing document contents", () => {
    expect(parseEpub(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const files = fixture();
    files.set(
      "OPS/text/chapter-0.xhtml",
      strToU8("<html><body><p>private text</body></html>"),
    );
    expect(parseEpub(files)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("rejects entity declarations and excessive XML depth", () => {
    const files = fixture();
    files.set(
      "OPS/text/chapter-0.xhtml",
      strToU8(
        '<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html><body><p>&x;</p></body></html>',
      ),
    );
    expect(parseEpub(files)).toEqual({ ok: false, reason: "unreadable" });
    files.set(
      "OPS/text/chapter-0.xhtml",
      strToU8(
        `<html><body>${"<div>".repeat(130)}deep${"</div>".repeat(130)}</body></html>`,
      ),
    );
    expect(parseEpub(files)).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses encrypted publications but permits declared font obfuscation", () => {
    const encryption = (algorithm: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="OPS/fonts/book.otf"/></CipherData></EncryptedData></encryption>`;
    expect(
      parseEpub(
        fixture({
          encryption: encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc"),
        }),
      ),
    ).toEqual({ ok: false, reason: "protected" });
    expect(
      parseEpub(
        fixture({
          encryption: encryption("http://www.idpf.org/2008/embedding"),
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseEpub(
        fixture({ encryption: encryption("http://ns.adobe.com/pdf/enc#RC") }),
      ).ok,
    ).toBe(true);
    expect(
      parseEpub(
        fixture({ encryption: "<encryption><EncryptedData/></encryption>" }),
      ),
    ).toEqual({ ok: false, reason: "protected" });
    expect(
      parseEpub(
        fixture({
          encryption: encryption("http://www.idpf.org/2008/embedding").replace(
            "OPS/fonts/book.otf",
            "OPS/text/chapter-0.xhtml",
          ),
        }),
      ),
    ).toEqual({ ok: false, reason: "protected" });
  });

  it("refuses a missing spine item, duplicate manifest ID and remote package", () => {
    const files = fixture();
    files.delete("OPS/text/chapter-0.xhtml");
    expect(parseEpub(files)).toEqual({ ok: false, reason: "not_epub" });
    const duplicate = fixture();
    const bytes = duplicate.get("OPS/package.opf");
    if (!bytes) throw new Error("Missing fixture package");
    duplicate.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder().decode(bytes).replace('id="font"', 'id="image"'),
      ),
    );
    expect(parseEpub(duplicate)).toEqual({ ok: false, reason: "not_epub" });
    const remote = fixture();
    remote.set(
      "META-INF/container.xml",
      strToU8(
        '<container><rootfiles><rootfile full-path="https://example.invalid/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
    );
    expect(parseEpub(remote)).toEqual({ ok: false, reason: "not_epub" });
  });

  it("refuses an empty spine or content with no readable text", () => {
    expect(parseEpub(fixture({ bodies: [] }))).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(
      parseEpub(
        fixture({
          bodies: [
            '<script>not reading text</script><img src="../images/chart.png" alt=""/>',
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "empty" });
  });

  it("bounds the input, expanded entries and entry count before parsing", () => {
    expect(parseEpub(new Uint8Array(EPUB_LIMITS.archiveBytes + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
    const oversized = fixture({
      extra: new Map([
        ["large.bin", new Uint8Array(EPUB_LIMITS.entryBytes + 1)],
      ]),
    });
    expect(parseEpub(archive(oversized))).toEqual({
      ok: false,
      reason: "too_long",
    });
    const crowded = fixture();
    for (let index = 0; index < EPUB_LIMITS.files; index++)
      crowded.set(`extra-${index}`, new Uint8Array());
    expect(parseEpub(crowded)).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects archive traversal paths and paragraphs that cannot fit a unit", () => {
    const files = fixture({ extra: new Map([["../outside", "unsafe"]]) });
    expect(parseEpub(archive(files))).toEqual({
      ok: false,
      reason: "not_epub",
    });
    expect(
      parseEpub(
        fixture({
          bodies: [`<p>${"word ".repeat(EPUB_LIMITS.unitWords + 1)}</p>`],
        }),
      ),
    ).toEqual({ ok: false, reason: "too_long" });
  });

  it("returns a typed refusal for deterministic damaged ZIP inputs rather than throwing", () => {
    const bytes = archive(fixture());
    for (let length = 0; length < bytes.length; length += 31)
      expect(parseEpub(bytes.slice(0, length)).ok).toBe(false);
    for (let length = 0; length < 512; length += 17) {
      const garbage = Uint8Array.from(
        { length },
        (_, index) => (index * 73 + length) % 256,
      );
      expect(parseEpub(garbage).ok).toBe(false);
    }
  });
});
