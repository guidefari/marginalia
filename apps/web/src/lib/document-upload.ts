import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  type DocumentFormat,
  documentFormat,
  problemWithFile,
  sha256Hex,
  type uploadWithProgress,
} from "./document-import";

export type UploadState = {
  fileName: string;
  format: DocumentFormat;
  percent: number;
  stage: "checking" | "uploading";
};

export type DocumentUploadOperations = {
  generateUploadUrl: (
    args: FunctionArgs<typeof api.documentImports.generateUploadUrl>,
  ) => Promise<string>;
  startImport: (
    args: FunctionArgs<typeof api.documentImports.start>,
  ) => Promise<FunctionReturnType<typeof api.documentImports.start>>;
  upload: typeof uploadWithProgress;
};

export async function uploadDocument(
  file: File,
  operations: DocumentUploadOperations,
  onUpload: (state: UploadState) => void,
) {
  const problem = problemWithFile(file);
  if (problem) return { ok: false, error: problem } as const;
  const format = documentFormat(file);
  if (!format)
    return {
      ok: false,
      error: "Marginalia reads PDF and EPUB files.",
    } as const;
  onUpload({ fileName: file.name, format, percent: 0, stage: "checking" });
  try {
    const sha256 = await sha256Hex(file);
    const url = await operations.generateUploadUrl({
      sha256,
      size: file.size,
      format,
    });
    onUpload({ fileName: file.name, format, percent: 0, stage: "uploading" });
    const storageId = await operations.upload(
      url,
      file,
      (percent) =>
        onUpload({ fileName: file.name, format, percent, stage: "uploading" }),
      format,
    );
    return await operations.startImport({
      // SAFETY: Convex storage returns the ID of the file just uploaded.
      storageId: storageId as FunctionArgs<
        typeof api.documentImports.start
      >["storageId"],
      fileName: file.name,
      format,
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "The upload didn't finish. Try again.",
    } as const;
  }
}
