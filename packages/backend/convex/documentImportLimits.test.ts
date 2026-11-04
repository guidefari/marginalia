import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import { MAX_PDF_BYTES } from "./documentImports";
import { EPUB_LIMITS } from "./lib/epub/archive";
import { storedSha256AsHex } from "./lib/uploadFingerprint";

const modules = import.meta.glob("./**/*.ts");
const formats: ("epub" | "pdf" | undefined)[] = ["epub", "pdf", undefined];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(
  formats,
)("checks the existing archive ceiling before granting %s uploads", async (format) => {
  const f = await secondReaderTest(modules);
  const limit = format === "epub" ? EPUB_LIMITS.archiveBytes : MAX_PDF_BYTES;
  const sha256 = "a".repeat(64);
  await expect(
    f.owner.mutation(api.documentImports.generateUploadUrl, {
      format,
      sha256,
      size: limit + 1,
    }),
  ).rejects.toThrow(`That file is over ${limit / 1024 / 1024} MB`);
  expect(await f.t.run((ctx) => ctx.db.query("uploadGrants").take(1))).toEqual(
    [],
  );
  expect(
    await f.owner.mutation(api.documentImports.generateUploadUrl, {
      format,
      sha256,
      size: limit,
    }),
  ).toEqual(expect.any(String));
});

it("independently refuses an oversized stored EPUB without spending its matching grant", async () => {
  const f = await secondReaderTest(modules);
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array(EPUB_LIMITS.archiveBytes + 1)], {
        type: "application/epub+zip",
      }),
    ),
  );
  const file = await f.t.run((ctx) => ctx.db.system.get(storageId));
  if (!file) throw new Error("Missing stored EPUB");
  const sha256 = storedSha256AsHex(file.sha256);
  if (!sha256) throw new Error("Missing EPUB fingerprint");
  await f.owner.mutation(api.documentImports.generateUploadUrl, {
    format: "pdf",
    sha256,
    size: file.size,
  });
  expect(
    await f.owner.mutation(api.documentImports.start, {
      storageId,
      fileName: "oversized.epub",
      format: "epub",
    }),
  ).toEqual({
    ok: false,
    error: "That file is over 32 MB, which is more than Marginalia can read.",
  });
  expect(
    await f.t.run((ctx) => ctx.db.query("documentImports").take(1)),
  ).toEqual([]);
  const grant = await f.t.run((ctx) => ctx.db.query("uploadGrants").first());
  expect(grant).not.toBeNull();
  expect(grant?.usedAt).toBeUndefined();
  expect(await f.t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
});

const pdfFormats: ("pdf" | undefined)[] = ["pdf", undefined];

it.each(
  pdfFormats,
)("starts a stored PDF exactly at 60 MiB with format %s", async (format) => {
  const f = await secondReaderTest(modules);
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array(MAX_PDF_BYTES)], { type: "application/pdf" }),
    ),
  );
  const file = await f.t.run((ctx) => ctx.db.system.get(storageId));
  if (!file) throw new Error("Missing stored PDF");
  const sha256 = storedSha256AsHex(file.sha256);
  if (!sha256) throw new Error("Missing PDF fingerprint");
  await f.owner.mutation(api.documentImports.generateUploadUrl, {
    format,
    sha256,
    size: file.size,
  });
  const started = await f.owner.mutation(api.documentImports.start, {
    format,
    storageId,
    fileName: "ceiling.pdf",
  });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error(started.error);
  const row = await f.t.run((ctx) => ctx.db.get(started.importId));
  expect(row?.status).toBe("reading");
  expect(row?.format).toBe(format);
});
