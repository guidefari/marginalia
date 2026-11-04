import { describe, expect, it, vi } from "vitest";
import {
  documentContentType,
  documentFormat,
  FAILURE_COPY,
  firstDocument,
  importFailureCopy,
  importSteps,
  isPdfFile,
  MAX_EPUB_MB,
  MAX_PDF_MB,
  problemWithFile,
  uploadWithProgress,
} from "./document-import";

const file = (name: string, type: string, size = 10) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("isPdfFile", () => {
  it("accepts the PDF type or a .pdf name", () => {
    expect(isPdfFile(file("a.bin", "application/pdf"))).toBe(true);
    expect(isPdfFile(file("Book.PDF", ""))).toBe(true);
    expect(isPdfFile(file("a.png", "image/png"))).toBe(false);
  });
});

describe("firstDocument", () => {
  it("skips files that are not PDFs", () => {
    const pdf = file("b.pdf", "application/pdf");
    expect(firstDocument([file("a.png", "image/png"), pdf])).toBe(pdf);
    expect(firstDocument([file("a.png", "image/png")])).toBeNull();
  });
});

describe("problemWithFile", () => {
  it("names what is wrong in a plain sentence", () => {
    expect(problemWithFile(file("a.png", "image/png"))).toBe(
      "Marginalia reads PDF and EPUB files.",
    );
    expect(
      problemWithFile(
        file("a.pdf", "application/pdf", MAX_PDF_MB * 1024 * 1024 + 1),
      ),
    ).toContain("over 60 MB");
    expect(problemWithFile(file("a.pdf", "application/pdf", 0))).toBe(
      "That file is empty.",
    );
    expect(problemWithFile(file("a.pdf", "application/pdf", 1000))).toBeNull();
  });
});

describe("EPUB admission and copy", () => {
  it("recognizes uppercase extensions, missing MIME types and EPUB MIME types", () => {
    expect(documentFormat(file("Book.EPUB", ""))).toBe("epub");
    expect(documentFormat(file("book.bin", "application/epub+zip"))).toBe(
      "epub",
    );
    expect(documentFormat(file("book.epub", "application/zip"))).toBe("epub");
    expect(documentFormat(file("book.zip", "application/zip"))).toBeNull();
    expect(documentContentType("epub")).toBe("application/epub+zip");
    expect(documentContentType("pdf")).toBe("application/pdf");
  });

  it("picks the first supported document in a mixed drop", () => {
    const epub = file("book.epub", "");
    const pdf = file("book.pdf", "application/pdf");
    expect(firstDocument([file("cover.png", "image/png"), epub, pdf])).toBe(
      epub,
    );
    expect(firstDocument([pdf, epub])).toBe(pdf);
  });

  it("accepts the EPUB limit exactly and rejects oversized and empty books", () => {
    const limit = MAX_EPUB_MB * 1024 * 1024;
    expect(problemWithFile(file("book.epub", "", limit))).toBeNull();
    expect(problemWithFile(file("book.epub", "", limit + 1))).toContain(
      "over 32 MB",
    );
    expect(problemWithFile(file("book.epub", "", 0))).toBe(
      "That file is empty.",
    );
    expect(problemWithFile(file("book.pdf", "", limit + 1))).toBeNull();
  });

  it("describes chapters without inventing pages", () => {
    expect(importSteps({ format: "epub", step: "point", units: 45 })).toEqual({
      done: ["Text from its chapters", "45 reading parts from its chapters"],
      current: "Opening it for reading…",
    });
    expect(importFailureCopy("too_long", "epub").detail).not.toContain("pages");
    expect(importFailureCopy("unreadable", "epub").sentence).toContain("EPUB");
    expect(importFailureCopy("empty", "epub").sentence).toContain("EPUB");
  });
});

describe("importSteps", () => {
  it("checks off a step as the import moves on", () => {
    expect(importSteps({ step: "text" })).toEqual({
      done: [],
      current: "Reading the text…",
    });
    expect(importSteps({ step: "sections", pages: 412 })).toEqual({
      done: ["Text from all 412 pages"],
      current: "Finding its sections…",
    });
    expect(importSteps({ step: "point", pages: 412, units: 58 })).toEqual({
      done: ["Text from all 412 pages", "58 reading parts from its chapters"],
      current: "Opening it for reading…",
    });
  });
  it("does not claim parts for a document that is one article", () => {
    expect(importSteps({ step: "point", pages: 6 }).done[1]).toBe(
      "Headings and paragraphs",
    );
  });
});

describe("FAILURE_COPY", () => {
  it("says the scan sentence from the comp and that nothing was added", () => {
    expect(FAILURE_COPY.scanned.sentence).toBe(
      "This PDF is scanned pages, with no text to read.",
    );
    for (const copy of Object.values(FAILURE_COPY))
      expect(copy.detail).toContain("Nothing was added to your library.");
  });
});

describe("uploadWithProgress", () => {
  class FakeRequest {
    static last: FakeRequest;
    upload: { onprogress?: (event: ProgressEvent) => void } = {};
    onerror?: () => void;
    onload?: () => void;
    onabort?: () => void;
    ontimeout?: () => void;
    status = 200;
    responseText = "";
    headers: Record<string, string> = {};
    constructor() {
      FakeRequest.last = this;
    }
    open() {}
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send() {}
  }

  it("settles when the request is cancelled or times out, so the import isn't left busy", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const file = new File(["%PDF-"], "a.pdf", { type: "application/pdf" });
    for (const end of ["onabort", "ontimeout"] as const) {
      const upload = uploadWithProgress("https://upload", file, () => {});
      FakeRequest.last[end]?.();
      await expect(upload).rejects.toThrow("The upload didn't finish.");
    }
    vi.unstubAllGlobals();
  });

  it("uploads EPUB bytes with the server's expected content type", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    try {
      const file = new File(["book"], "Book.EPUB");
      const upload = uploadWithProgress(
        "https://upload",
        file,
        () => {},
        "epub",
      );
      expect(FakeRequest.last.headers["Content-Type"]).toBe(
        "application/epub+zip",
      );
      FakeRequest.last.responseText = JSON.stringify({
        storageId: "stored-book",
      });
      FakeRequest.last.onload?.();
      await expect(upload).resolves.toBe("stored-book");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "{}",
    '{"storageId":null}',
    '{"storageId":""}',
    "not-json",
  ])("rejects a malformed storage response: %s", async (responseText) => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    try {
      const upload = uploadWithProgress(
        "https://upload",
        new File(["book"], "book.epub"),
        () => {},
        "epub",
      );
      FakeRequest.last.responseText = responseText;
      FakeRequest.last.onload?.();
      await expect(upload).rejects.toThrow("The upload didn't finish.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
