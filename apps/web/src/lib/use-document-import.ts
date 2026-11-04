"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { uploadWithProgress } from "./document-import";
import { type UploadState, uploadDocument } from "./document-upload";
import { invalidateTopicSearchCache } from "./topic-search-cache";

/**
 * Uploads a document to storage and starts its import. The server's steps then
 * arrive through `documentImports.latest`; this only holds the part before
 * that, and any problem with the file itself.
 */
export function useDocumentImport() {
  const generateUploadUrl = useMutation(api.documentImports.generateUploadUrl);
  const startImport = useMutation(api.documentImports.start);
  const dismiss = useMutation(api.documentImports.dismiss);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [importId, setImportId] = useState<Id<"documentImports"> | null>(null);
  const busy = useRef(false);

  const start = useCallback(
    async (file: File) => {
      if (busy.current) return;
      busy.current = true;
      setProblem(null);
      setImportId(null);
      try {
        const result = await uploadDocument(
          file,
          { generateUploadUrl, startImport, upload: uploadWithProgress },
          setUpload,
        );
        if (!result.ok) setProblem(result.error);
        else {
          setImportId(result.importId);
          invalidateTopicSearchCache();
        }
      } finally {
        busy.current = false;
        setUpload(null);
      }
    },
    [generateUploadUrl, startImport],
  );

  return {
    start,
    upload,
    importId,
    problem,
    clearProblem: () => setProblem(null),
    dismiss: (importId: Id<"documentImports">) =>
      dismiss({ importId }).catch(() => {}),
  };
}
