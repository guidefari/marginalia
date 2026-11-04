import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeEpub, tinyRasters } from "../test/epub";
import { runScheduled, secondReaderTest } from "../test/owner";
import { makePdf } from "../test/pdf";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deleteArticle } from "./lib/feedRemoval";
import { storedSha256AsHex } from "./lib/uploadFingerprint";

const modules = import.meta.glob("./**/*.ts");
type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("keeps uploads without format on the PDF path", async () => {
  const f = await secondReaderTest(modules);
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(
      new Blob(
        [
          Uint8Array.from(
            makePdf([
              Array.from(
                { length: 8 },
                (_, index) =>
                  `A generated paragraph ${index} with enough words to read.`,
              ),
            ]),
          ),
        ],
        { type: "application/pdf" },
      ),
    ),
  );
  const file = await f.t.run((ctx) => ctx.db.system.get(storageId));
  if (!file) throw new Error("Missing PDF");
  const sha256 = storedSha256AsHex(file.sha256);
  if (!sha256) throw new Error("Missing PDF hash");
  await f.owner.mutation(api.documentImports.generateUploadUrl, {
    sha256,
    size: file.size,
  });
  const started = await f.owner.mutation(api.documentImports.start, {
    storageId,
    fileName: "fixture.pdf",
  });
  if (!started.ok) throw new Error(started.error);
  await f.t.action(internal.actions.importPdf.run, {
    importId: started.importId,
  });
  const row = await f.t.run((ctx) => ctx.db.get(started.importId));
  expect(row).toMatchObject({ status: "ready", pages: 1 });
  expect(row?.format).toBeUndefined();
  expect(await f.t.run((ctx) => ctx.db.query("books").take(1))).toEqual([]);
});

async function start(f: Fixture, bytes = makeEpub(), client = f.owner) {
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(
      new Blob([Uint8Array.from(bytes)], { type: "application/epub+zip" }),
    ),
  );
  const meta = await f.t.run((ctx) => ctx.db.system.get(storageId));
  if (!meta) throw new Error("Missing upload");
  const sha256 = storedSha256AsHex(meta.sha256);
  if (!sha256) throw new Error("Missing hash");
  await client.mutation(api.documentImports.generateUploadUrl, {
    sha256,
    size: meta.size,
    format: "epub",
  });
  const result = await client.mutation(api.documentImports.start, {
    storageId,
    fileName: "fixture.epub",
    format: "epub",
  });
  if (!result.ok) throw new Error(result.error);
  return { importId: result.importId, storageId };
}

async function pending(f: Fixture, importId: Id<"documentImports">) {
  const articleId = await f.t.mutation(internal.books.createBookArticle, {
    importId,
    userId: "default_user",
    guid: `upload:${importId}`,
    title: "Fixture",
    excerpt: "Fixture",
    fileName: "fixture.epub",
    wordCount: 2,
    estimatedReadMinutes: 1,
    outline: [{ title: "Part", minutes: 1 }],
  });
  if (!articleId) throw new Error("Missing pending article");
  return articleId;
}

it("publishes an owned book with spans, registered raster images and no fabricated pages", async () => {
  const f = await secondReaderTest(modules, { transactionLimits: true });
  const input = await start(f);
  await Promise.all([
    f.t.action(internal.actions.importEpub.run, { importId: input.importId }),
    f.t.action(internal.actions.importEpub.run, { importId: input.importId }),
  ]);
  const row = await f.t.run((ctx) => ctx.db.get(input.importId));
  expect(row).toMatchObject({ status: "ready", format: "epub", units: 1 });
  expect(row?.pages).toBeUndefined();
  if (!row?.articleId) throw new Error("Missing article");
  const articleId = row.articleId;
  const article = await f.t.run((ctx) => ctx.db.get(articleId));
  expect(article?.pageCount).toBeUndefined();
  const unit = await f.owner.query(api.books.unit, {
    articleId: row.articleId,
    index: 0,
  });
  expect(unit?.sourceSpans).toEqual([{ spineIndex: 0, start: 0, end: 70 }]);
  expect(unit?.contentHtml).toContain('<img src="https://');
  expect(unit?.contentHtml).toContain("&lt;missing&gt;");
  expect(unit?.contentHtml).not.toMatch(
    /data-epub-image|publisher\.invalid|<script/,
  );
  expect(
    await f.reader.query(api.books.unit, {
      articleId: row.articleId,
      index: 0,
    }),
  ).toBeNull();
  const images = await f.t.run((ctx) => ctx.db.query("bookImages").take(5));
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    userId: "default_user",
    articleId: row.articleId,
    href: "OPS/chart.png",
  });
  expect(await f.t.run((ctx) => ctx.storage.get(input.storageId))).toBeNull();
  await f.t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").take(100);
    for (const job of jobs) await ctx.scheduler.cancel(job._id);
  });
  vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
  await f.t.mutation(internal.documentImports.sweepUploads, {});
  const image = images[0];
  if (!image) throw new Error("Missing image");
  expect(
    await f.t.run((ctx) => ctx.db.system.get(image.storageId)),
  ).not.toBeNull();
  await f.t.run(async (ctx) => {
    const current = await ctx.db.get(articleId);
    if (current) await deleteArticle(ctx, current);
  });
  await runScheduled(f.t);
  expect(await f.t.run((ctx) => ctx.storage.get(image.storageId))).toBeNull();
});

it.each([
  { bytes: zipSync({ mimetype: strToU8("not an epub") }), reason: "not_epub" },
  { bytes: new Uint8Array([1, 2, 3]), reason: "unreadable" },
  { bytes: makeEpub({ protected: true }), reason: "protected" },
])("refuses $reason and removes its upload", async ({ bytes, reason }) => {
  const f = await secondReaderTest(modules);
  const input = await start(f, bytes);
  await f.t.action(internal.actions.importEpub.run, {
    importId: input.importId,
  });
  expect(await f.t.run((ctx) => ctx.db.get(input.importId))).toMatchObject({
    status: "failed",
    failure: reason,
  });
  expect(await f.t.run((ctx) => ctx.storage.get(input.storageId))).toBeNull();
  expect(await f.t.run((ctx) => ctx.db.query("articles").take(1))).toEqual([]);
});

it("keeps invalid raster bytes as escaped alt text without storing assets", async () => {
  const f = await secondReaderTest(modules);
  const input = await start(
    f,
    makeEpub({ image: new TextEncoder().encode("<script>alert(1)</script>") }),
  );
  await f.t.action(internal.actions.importEpub.run, {
    importId: input.importId,
  });
  const unit = await f.t.run((ctx) => ctx.db.query("bookUnits").first());
  expect(unit?.contentHtml).toContain("A &amp; B");
  expect(unit?.contentHtml).not.toContain("<img");
  expect(await f.t.run((ctx) => ctx.db.query("bookImages").take(1))).toEqual(
    [],
  );
});

it.each(
  tinyRasters,
)("stores a complete generated $mediaType raster", async (image) => {
  const f = await secondReaderTest(modules);
  const input = await start(
    f,
    makeEpub({ image: image.bytes, imageMediaType: image.mediaType }),
  );
  await f.t.action(internal.actions.importEpub.run, {
    importId: input.importId,
  });
  expect((await f.t.run((ctx) => ctx.db.get(input.importId)))?.status).toBe(
    "ready",
  );
  expect(
    await f.t.run((ctx) => ctx.db.query("bookImages").take(2)),
  ).toHaveLength(1);
});

const headerOnlyRasters = tinyRasters.map((image) => ({
  mediaType: image.mediaType,
  bytes:
    image.mediaType === "image/png"
      ? Uint8Array.from([
          ...image.bytes.subarray(0, 33),
          ...image.bytes.subarray(-12),
        ])
      : image.mediaType === "image/jpeg"
        ? Uint8Array.from([255, 216, 255, 217])
        : image.mediaType === "image/gif"
          ? Uint8Array.from([...image.bytes.subarray(0, 19), 59])
          : Uint8Array.from([
              ...new TextEncoder().encode("RIFF"),
              22,
              0,
              0,
              0,
              ...new TextEncoder().encode("WEBPVP8X"),
              10,
              0,
              0,
              0,
              ...new Uint8Array(10),
            ]),
}));

it.each([
  ...headerOnlyRasters.map((image) => ({ ...image, kind: "header-only" })),
  ...tinyRasters.map((image) => ({
    ...image,
    bytes: image.bytes.subarray(0, image.bytes.length - 2),
    kind: "truncated",
  })),
])("keeps $kind $mediaType as escaped fallback without storing an image", async (image) => {
  const f = await secondReaderTest(modules);
  const input = await start(
    f,
    makeEpub({ image: image.bytes, imageMediaType: image.mediaType }),
  );
  await f.t.action(internal.actions.importEpub.run, {
    importId: input.importId,
  });
  expect((await f.t.run((ctx) => ctx.db.get(input.importId)))?.status).toBe(
    "ready",
  );
  expect(await f.t.run((ctx) => ctx.db.query("bookImages").take(1))).toEqual(
    [],
  );
  const unit = await f.t.run((ctx) => ctx.db.query("bookUnits").first());
  expect(unit?.contentHtml).toContain("A &amp; B");
  expect(unit?.contentHtml).not.toMatch(/<img|data-epub-image/);
});

const publicationWrites: ("register" | "addUnits" | "finishBook")[] = [
  "register",
  "addUnits",
  "finishBook",
];

it.each(
  publicationWrites,
)("fences %s when deletion starts during a live pending import", async (firstWrite) => {
  const f = await secondReaderTest(modules);
  const input = await start(f, makeEpub(), f.reader);
  const articleId = await f.t.mutation(internal.books.createBookArticle, {
    importId: input.importId,
    userId: f.readerLibraryId,
    guid: `upload:${input.importId}`,
    title: "Pending fixture",
    excerpt: "Pending fixture",
    fileName: "fixture.epub",
    wordCount: 2,
    estimatedReadMinutes: 1,
    outline: [{ title: "Part", minutes: 1 }],
  });
  if (!articleId) throw new Error("Missing pending article");
  const image = tinyRasters[0];
  if (!image) throw new Error("Missing generated raster");
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(
      new Blob([Uint8Array.from(image.bytes)], { type: image.mediaType }),
    ),
  );
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: input.importId,
      articleId,
      storageId,
      href: "before.png",
    }),
  ).not.toBeNull();
  expect((await f.t.run((ctx) => ctx.db.get(input.importId)))?.status).toBe(
    "reading",
  );
  expect(
    (await f.t.run((ctx) => ctx.db.get(articleId)))?.extractionStatus,
  ).toBe("pending");
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(100))
      await ctx.scheduler.cancel(job._id);
  });
  await f.reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
  expect((await f.t.run((ctx) => ctx.db.get(input.importId)))?.status).toBe(
    "reading",
  );
  const late = await f.t.run((ctx) =>
    ctx.storage.store(
      new Blob([Uint8Array.from(image.bytes)], { type: image.mediaType }),
    ),
  );
  const attempts = {
    register: async () =>
      expect(
        await f.t.mutation(internal.bookImages.register, {
          importId: input.importId,
          articleId,
          storageId: late,
          href: "after.png",
        }),
      ).toBeNull(),
    addUnits: async () =>
      expect(
        await f.t.mutation(internal.books.addUnits, {
          importId: input.importId,
          userId: f.readerLibraryId,
          articleId,
          units: [
            {
              index: 0,
              title: "Part",
              content: "Late text",
              contentHtml: "<p>Late text</p>",
              wordCount: 2,
              estimatedReadMinutes: 1,
            },
          ],
        }),
      ).toBe(false),
    finishBook: async () =>
      expect(
        await f.t.mutation(internal.books.finishBook, {
          importId: input.importId,
          userId: f.readerLibraryId,
          articleId,
          title: "Pending fixture",
          units: 1,
          firstUnitTitle: "Part",
          firstUnitMinutes: 1,
        }),
      ).toBe(false),
  };
  await attempts[firstWrite]();
  for (const write of publicationWrites) await attempts[write]();
  expect(await f.t.run((ctx) => ctx.db.query("bookUnits").take(1))).toEqual([]);
  expect(await f.t.run((ctx) => ctx.db.query("books").take(1))).toEqual([]);
  await runScheduled(f.t, { maxSteps: 300 });
  expect(await f.t.run((ctx) => ctx.db.query("bookImages").take(1))).toEqual(
    [],
  );
  expect(await f.t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
});

it.each([
  "failure",
  "expiry",
])("drains partial assets after %s and rejects late registration", async (mode) => {
  const f = await secondReaderTest(modules);
  const input = await start(f);
  const articleId = await pending(f, input.importId);
  const ids: Id<"_storage">[] = [];
  for (let index = 0; index < 51; index++) {
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob([`image${index}`], { type: "image/png" })),
    );
    ids.push(storageId);
    expect(
      await f.t.mutation(internal.bookImages.register, {
        importId: input.importId,
        articleId,
        storageId,
        href: `${index}.png`,
      }),
    ).not.toBeNull();
  }
  if (mode === "failure")
    await f.t.mutation(internal.documentImports.fail, {
      importId: input.importId,
      failure: "unreadable",
    });
  else
    await f.t.mutation(internal.documentImports.expire, {
      importId: input.importId,
    });
  const orphan = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["orphan"])),
  );
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: input.importId,
      articleId,
      storageId: orphan,
      href: "late.png",
    }),
  ).toBeNull();
  await f.t.mutation(internal.books.discardBook, {
    importId: input.importId,
    articleId,
    userId: "default_user",
  });
  expect(
    (await f.t.run((ctx) => ctx.db.get(input.importId)))?.partialArticleId,
  ).toBe(articleId);
  await f.t.mutation(internal.books.discardBook, {
    importId: input.importId,
    articleId,
    userId: "default_user",
  });
  expect(
    (await f.t.run((ctx) => ctx.db.get(input.importId)))?.partialArticleId,
  ).toBeUndefined();
  for (const id of ids)
    expect(await f.t.run((ctx) => ctx.storage.get(id))).toBeNull();
  await f.t.mutation(internal.documentImports.sweepUploads, {});
  expect(await f.t.run((ctx) => ctx.db.system.get(orphan))).not.toBeNull();
  vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
  await f.t.mutation(internal.documentImports.sweepUploads, {});
  expect(await f.t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
});

it("publishes generated near-budget units within argument and transaction limits", async () => {
  const f = await secondReaderTest(modules, { transactionLimits: true });
  const paragraph = `<p>${"x".repeat(190_000)}</p>`;
  const input = await start(f, makeEpub({ body: paragraph.repeat(14) }));
  await f.t.action(internal.actions.importEpub.run, {
    importId: input.importId,
  });
  expect(await f.t.run((ctx) => ctx.db.get(input.importId))).toMatchObject({
    status: "ready",
    units: 14,
  });
  const units = await f.t.run((ctx) => ctx.db.query("bookUnits").take(20));
  expect(units).toHaveLength(14);
  expect(
    units.every(
      (unit) =>
        new TextEncoder().encode(unit.contentHtml + unit.content).length >
        380_000,
    ),
  ).toBe(true);
});

it("fences image registration by import, article owner, pending state and storage ownership", async () => {
  const f = await secondReaderTest(modules);
  const first = await start(f);
  const articleId = await pending(f, first.importId);
  const other = await start(f, makeEpub(), f.reader);
  const image = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["raster"], { type: "image/png" })),
  );
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: other.importId,
      articleId,
      storageId: image,
      href: "image.png",
    }),
  ).toBeNull();
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: first.importId,
      articleId,
      storageId: first.storageId,
      href: "upload.png",
    }),
  ).toBeNull();
  const registered = await f.t.mutation(internal.bookImages.register, {
    importId: first.importId,
    articleId,
    storageId: image,
    href: "image.png",
  });
  expect(registered).not.toBeNull();
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: other.importId,
      articleId,
      storageId: image,
      href: "stolen.png",
    }),
  ).toBeNull();
  expect(
    await f.reader.mutation(api.documentImports.start, {
      storageId: image,
      fileName: "stolen.epub",
      format: "epub",
    }),
  ).toMatchObject({ ok: false });
  await f.t.run((ctx) =>
    ctx.db.patch(articleId, { extractionStatus: "extracted" }),
  );
  const late = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["raster"], { type: "image/png" })),
  );
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: first.importId,
      articleId,
      storageId: late,
      href: "late.png",
    }),
  ).toBeNull();
});

it("purges more than one image batch during account deletion without touching another owner", async () => {
  const f = await secondReaderTest(modules, { transactionLimits: true });
  const input = await start(f, makeEpub(), f.reader);
  await f.t.action(internal.actions.importEpub.run, {
    importId: input.importId,
  });
  const imported = await f.t.run((ctx) => ctx.db.get(input.importId));
  if (!imported?.articleId) throw new Error("Missing imported article");
  const articleId = imported.articleId;
  const ownerInput = await start(f);
  const ownerArticle = await pending(f, ownerInput.importId);
  const kept = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["owner"], { type: "image/png" })),
  );
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: ownerInput.importId,
      articleId: ownerArticle,
      storageId: kept,
      href: "owner.png",
    }),
  ).not.toBeNull();
  const removed: Id<"_storage">[] = [];
  await f.t.run(async (ctx) => {
    for (let index = 0; index < 51; index++) {
      const storageId = await ctx.storage.store(
        new Blob([`fixture-${index}`], { type: "image/png" }),
      );
      removed.push(storageId);
      await ctx.db.insert("bookImages", {
        userId: f.readerLibraryId,
        articleId,
        storageId,
        href: `${index}.png`,
      });
    }
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(100))
      await ctx.scheduler.cancel(job._id);
  });
  await f.reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
  expect(
    await f.t.mutation(internal.bookImages.register, {
      importId: input.importId,
      articleId,
      storageId: kept,
      href: "late.png",
    }),
  ).toBeNull();
  await runScheduled(f.t, { maxSteps: 300 });
  const remaining = await f.t.run((ctx) =>
    ctx.db.query("bookImages").take(100),
  );
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.userId).toBe("default_user");
  expect(await f.t.run((ctx) => ctx.db.system.get(kept))).not.toBeNull();
  for (const storageId of removed)
    expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
});
