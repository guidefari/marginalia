import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import schema from "../../../../packages/backend/convex/schema";
import {
  type DocumentUploadOperations,
  type UploadState,
  uploadDocument,
} from "./document-upload";

let operations: DocumentUploadOperations;
let grants: Parameters<DocumentUploadOperations["generateUploadUrl"]>[0][];
let starts: Parameters<DocumentUploadOperations["startImport"]>[0][];
let uploads: Parameters<DocumentUploadOperations["upload"]>[];
let states: UploadState[];

beforeEach(async () => {
  grants = [];
  starts = [];
  uploads = [];
  states = [];
  const t = convexTest(schema, {
    "./_generated/api.js": () =>
      import("@marginalia/backend/convex/_generated/api"),
  });
  const { storageId, importId } = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["book"]));
    const importId = await ctx.db.insert("documentImports", {
      userId: "reader",
      storageId,
      fileName: "book.epub",
      status: "reading",
      step: "text",
      createdAt: 0,
      updatedAt: 0,
    });
    return { storageId, importId };
  });
  operations = {
    async generateUploadUrl(args) {
      grants.push(args);
      return "https://upload.test/book";
    },
    async upload(...args) {
      uploads.push(args);
      args[2](75);
      return storageId;
    },
    async startImport(args) {
      starts.push(args);
      return { ok: true, importId };
    },
  };
});

describe("document upload", () => {
  it.each([
    "pdf",
    "epub",
  ] as const)("binds %s bytes and format across grant, upload and start", async (format) => {
    const file = new File(["book bytes"], `book.${format}`);
    const result = await uploadDocument(file, operations, (state) =>
      states.push(state),
    );
    expect(result.ok).toBe(true);
    expect(grants).toEqual([
      {
        sha256: createHash("sha256").update("book bytes").digest("hex"),
        size: 10,
        format,
      },
    ]);
    expect(uploads[0]?.[1]).toBe(file);
    expect(uploads[0]?.[3]).toBe(format);
    expect(starts).toEqual([
      { storageId: expect.any(String), fileName: file.name, format },
    ]);
    expect(states).toEqual([
      { fileName: file.name, format, percent: 0, stage: "checking" },
      { fileName: file.name, format, percent: 0, stage: "uploading" },
      { fileName: file.name, format, percent: 75, stage: "uploading" },
    ]);
  });

  it("refuses unsupported and empty files before requesting storage", async () => {
    for (const file of [
      new File(["image"], "cover.png"),
      new File([], "book.epub"),
    ]) {
      expect((await uploadDocument(file, operations, () => {})).ok).toBe(false);
    }
    expect(grants).toEqual([]);
    expect(uploads).toEqual([]);
    expect(starts).toEqual([]);
  });

  it("does not upload when the grant is refused", async () => {
    operations.generateUploadUrl = async () => {
      throw new Error("Reload and try again.");
    };
    expect(
      await uploadDocument(
        new File(["book"], "book.epub"),
        operations,
        () => {},
      ),
    ).toEqual({ ok: false, error: "Reload and try again." });
    expect(uploads).toEqual([]);
    expect(starts).toEqual([]);
  });

  it("never starts an import after upload failure", async () => {
    operations.upload = async () => {
      throw new Error("The upload didn't finish.");
    };
    expect(
      (
        await uploadDocument(
          new File(["book"], "book.epub"),
          operations,
          () => {},
        )
      ).ok,
    ).toBe(false);
    expect(starts).toEqual([]);
  });

  it("retains a server refusal after bytes are uploaded", async () => {
    operations.startImport = async () => ({
      ok: false,
      error: "This upload has expired.",
    });
    expect(
      await uploadDocument(
        new File(["book"], "book.epub"),
        operations,
        () => {},
      ),
    ).toEqual({ ok: false, error: "This upload has expired." });
    expect(uploads).toHaveLength(1);
  });
});
