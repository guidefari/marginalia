// @vitest-environment happy-dom

import {
  narrationSource,
  validateNarration,
} from "@marginalia/backend/narration";
import { describe, expect, it } from "vitest";
import { buildQueue } from "./listen-queue";
import { narrationEntries, spokenBlock } from "./spoken-text";

function entries(html: string) {
  document.body.innerHTML = `<div data-article-body>${html}</div>`;
  const body = document.querySelector<HTMLElement>("[data-article-body]")!;
  return narrationEntries(
    body,
    Array.from(body.querySelectorAll<HTMLElement>("[data-para]")),
  );
}

describe("source-linked narration inventory", () => {
  it("keeps headings, table labels, signed values, blank versus zero, code and the final paragraph in order", () => {
    const html =
      '<h2 data-para="1">TL;DR</h2><p data-para="2">Developers tend to build.</p><table><caption>Change, in percent</caption><tr><th>Region</th><th>2025</th></tr><tr><th>North</th><td>-0.5%</td></tr><tr><th>South</th><td></td></tr><tr><th>West</th><td>0</td></tr></table><pre data-para="3"><code>if (count &lt;= 3) return false;</code></pre><p data-para="4">This final exception matters.</p>';
    const result = entries(html);
    expect(result.map((item) => item.spoken.kind)).toEqual([
      "heading",
      "prose",
      "table",
      "code",
      "prose",
    ]);
    const table = result[2].spoken.text;
    expect(table).toContain("Region: North; 2025: -0.5%");
    expect(table).toContain("Region: South; 2025: blank");
    expect(table).toContain("Region: West; 2025: 0");
    expect(result[3].spoken.text).toContain("count <= 3");
    expect(result.at(-1)?.spoken.text).toBe("This final exception matters.");
    expect(document.querySelector("[data-article-body]")?.innerHTML).toContain(
      'data-para="4"',
    );
    expect(document.querySelector("pre code")?.textContent).toBe(
      "if (count <= 3) return false;",
    );
    expect(result.map((item) => item.sourceIndex)).toEqual([0, 1, 1, 2, 3]);
  });

  it("uses source image alternatives, ignores decoration, and discloses unavailable pixels instead of inventing a trend", () => {
    const result = entries(
      '<p data-para="1">The chart follows.</p><img alt="" src="decorative.png"><figure><img alt="Revenue chart, log scale. Forecast is uncertain." src="chart.png"><figcaption data-para="2">Figure 1, estimates.</figcaption></figure><img src="missing.png"><p data-para="3">End.</p>',
    );
    const images = result.filter((item) => item.spoken.kind === "image");
    expect(images).toHaveLength(2);
    expect(images[0].spoken.text).toContain("log scale. Forecast is uncertain");
    expect(images[1].spoken.text).toContain("no description was provided");
    expect(images[1].spoken.text).not.toMatch(/rises|falls|growth/);
    expect(
      result.filter((item) => item.spoken.text === "Figure 1, estimates."),
    ).toHaveLength(1);
  });

  it("includes inline informative images and never numbers or narrates application UI", () => {
    const result = entries(
      '<p data-para="1">Before <img alt="A red warning sign"> after.</p><div data-marginalia-ui><p data-para="2">Ignore this answer</p><img alt="Not source"></div>',
    );
    expect(result).toHaveLength(1);
    expect(result[0].spoken.text).toContain("A red warning sign");
  });

  it("retains mathematical exponents rather than deleting them as footnotes", () => {
    entries('<p data-para="1">10<sup>2</sup> is not 10.</p>');
    expect(spokenBlock(document.querySelector("p")!)?.text).toContain(
      "10 to the power of 2",
    );
  });

  it("recognizes citation links after years before applying exponent rules, and retains inline code indices", () => {
    entries(
      '<p data-para="1">2025<sup><a href="#note1">1</a></sup>. Use <code>arr[12]</code>. x<sup>2</sup>.</p>',
    );
    const text = spokenBlock(document.querySelector("p")!)?.text;
    expect(text).not.toContain("2025 to the power of 1");
    expect(text).toContain("arr[12]");
    expect(text).toContain("x to the power of 2");
  });

  it("retains explicit long descriptions even when an image has empty alt", () => {
    const result = entries(
      '<p data-para="1">Chart follows.</p><img alt="" aria-describedby="chart-detail"><div id="chart-detail">The chart uses a logarithmic scale; estimates are uncertain.</div>',
    );
    expect(
      result.find((item) => item.spoken.kind === "image")?.spoken.text,
    ).toContain("logarithmic scale; estimates are uncertain");
  });

  it("records the full canonical paragraph range covered by a single table anchor", () => {
    const result = entries(
      '<p data-para="1">Before.</p><table><tr><td><p data-para="2">A</p></td><td><p data-para="3">-2</p></td></tr></table><p data-para="4">After.</p>',
    );
    const table = result.find((item) => item.spoken.kind === "table");
    expect(table?.sourceIndex).toBe(1);
    expect(table?.sourceEndIndex).toBe(2);
  });

  it("passes every opening, middle and closing chunk of a long table through the production preparation contract", () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) => `<tr><th>Region ${i}</th><td>-${i}.50%</td></tr>`,
    ).join("");
    const result = entries(
      `<table><tr><th>Region</th><th>Change</th></tr>${rows}</table><p data-para="1">Final exception.</p>`,
    );
    const queue = buildQueue(
      result.map((item) => item.spoken),
      0,
      "en",
      undefined,
      1000,
    );
    const tableChunks = queue.filter((item) => item.kind === "table");
    expect(tableChunks.length).toBeGreaterThan(2);
    const prepared = tableChunks.map((item) =>
      validateNarration(
        narrationSource(item.text, "table"),
        { edits: [] },
        "table",
      ),
    );
    const text = prepared.join(" ");
    for (let i = 0; i < 60; i++) expect(text).toContain(`Change: -${i}.50%`);
    expect(queue.at(-1)?.text).toBe("Final exception.");
  });

  it("bounds every source chunk, including Unicode, and preserves heading and code kinds", () => {
    const result = entries(
      `<h2 data-para="1">Heading</h2><pre data-para="2">${"x = 123; 😀\n".repeat(50)}</pre>`,
    );
    const queue = buildQueue(
      result.map((item) => item.spoken),
      0,
      "en",
      undefined,
      1000,
    );
    expect(queue.every((item) => item.text.length <= 1000)).toBe(true);
    expect(queue[0].kind).toBe("heading");
    expect(queue.slice(1).every((item) => item.kind === "code")).toBe(true);
    for (const item of queue) expect(item.text.isWellFormed()).toBe(true);
    expect(queue[1].text).toBe(result[1].spoken.text);
  });

  it("preserves a complete Python branch and its indentation instead of applying the short prose lead", () => {
    const code = `if allowed:\n    result = ${"name + ".repeat(45)}name\nelse:\n    result = None\n`;
    expect(code.length).toBeGreaterThan(300);
    const result = entries(`<pre data-para="1">${code}</pre>`);
    const queue = buildQueue(
      result.map((item) => item.spoken),
      0,
      "en",
      undefined,
      1000,
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].text).toBe(code);
  });

  it("discloses oversized code rather than sending misleading context-free fragments", () => {
    const code = "if allowed:\n    work()\n".repeat(100);
    const result = entries(`<pre data-para="1">${code}</pre>`);
    const queue = buildQueue(
      result.map((item) => item.spoken),
      0,
      "en",
      undefined,
      1000,
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].text).toContain("too long to explain reliably");
    expect(document.querySelector("pre")?.textContent).toBe(code);
  });

  it("reads an ARIA-linked caption once at its own source position", () => {
    const result = entries(
      '<figure><img alt="" aria-describedby="cap"><figcaption id="cap" data-para="1">Revenue fell 40 percent.</figcaption></figure>',
    );
    const text = result.map((item) => item.spoken.text).join(" ");
    expect(text.match(/Revenue fell 40 percent/g)).toHaveLength(1);
  });
});
