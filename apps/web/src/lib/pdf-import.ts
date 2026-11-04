// What the desk shows while a PDF is brought in (rung 3b). Copy lives here so
// the refusals read the same wherever they appear.

/** The server refuses larger files (documentImports.MAX_PDF_BYTES). */
export const MAX_PDF_MB = 60;

export type ImportFailure =
  | "scanned"
  | "too_long"
  | "unreadable"
  | "empty"
  | "too_slow"
  | "protected"
  | "not_epub";

export function isPdfFile(file: Pick<File, "name" | "type">): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** The first dropped item that is a PDF, so a stray image alongside it doesn't stop the import. */
export function firstPdf(files: Iterable<File>): File | null {
  for (const file of files) if (isPdfFile(file)) return file;
  return null;
}

/** A problem with the file itself, found before anything is uploaded. */
export function problemWithFile(file: File): string | null {
  if (!isPdfFile(file)) return "Marginalia reads PDF files.";
  if (file.size > MAX_PDF_MB * 1024 * 1024)
    return `That file is over ${MAX_PDF_MB} MB, which is more than Marginalia can read.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

export const FAILURE_COPY: Record<
  ImportFailure,
  { sentence: string; detail: string }
> = {
  scanned: {
    sentence: "This PDF is scanned pages, with no text to read.",
    detail:
      "Marginalia can only read PDFs that contain text. Nothing was added to your library.",
  },
  too_long: {
    sentence: "This PDF is longer than Marginalia can read.",
    detail: "It has more than 1,500 pages. Nothing was added to your library.",
  },
  empty: {
    sentence: "Marginalia found no text it could read in this PDF.",
    detail: "Nothing was added to your library.",
  },
  too_slow: {
    sentence: "This PDF took too long to read.",
    detail:
      "It may be too large or too complex. Nothing was added to your library.",
  },
  unreadable: {
    sentence: "Marginalia couldn't open this PDF.",
    detail:
      "It may be damaged or locked with a password. Nothing was added to your library.",
  },
  protected: {
    sentence: "This file is protected and can't be read.",
    detail:
      "Choose a file without copy protection. Nothing was added to your library.",
  },
  not_epub: {
    sentence: "This file isn't a valid EPUB.",
    detail: "Nothing was added to your library.",
  },
};

export interface ImportSteps {
  /** Lines already done, in order */
  done: string[];
  /** The line being worked on */
  current: string;
}

export function importSteps(input: {
  step: "text" | "sections" | "point";
  pages?: number;
  units?: number;
}): ImportSteps {
  const done: string[] = [];
  if (input.step !== "text")
    done.push(
      input.pages
        ? `Text from all ${input.pages.toLocaleString()} pages`
        : "Text from every page",
    );
  if (input.step === "point")
    done.push(
      input.units
        ? `${input.units.toLocaleString()} reading parts from its chapters`
        : "Headings and paragraphs",
    );
  const current = {
    text: "Reading the text…",
    sections: "Finding its sections…",
    point: "Opening it for reading…",
  }[input.step];
  return { done, current };
}

/**
 * The file's SHA-256 as lowercase hex, which the server checks against the
 * stored file so an upload grant covers only these bytes. WebCrypto cannot
 * hash a stream, so this holds the whole file in memory once more (up to
 * MAX_PDF_MB) for the length of one digest call.
 */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Uploads with progress, which `fetch` can't report. */
export function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", "application/pdf");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The upload didn't finish."));
    // A cancelled request fires neither error nor load, which left the import busy
    request.onabort = () => reject(new Error("The upload didn't finish."));
    request.ontimeout = () => reject(new Error("The upload didn't finish."));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300)
        return reject(new Error("The upload didn't finish."));
      try {
        resolve(String(JSON.parse(request.responseText).storageId));
      } catch {
        reject(new Error("The upload didn't finish."));
      }
    };
    request.send(file);
  });
}
