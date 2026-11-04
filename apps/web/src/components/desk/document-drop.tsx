"use client";
import { FileDrop } from "@/components/file-drop";
import { firstDocument } from "@/lib/document-import";

export function DocumentDrop({ onFile }: { onFile: (file: File) => void }) {
  return (
    <FileDrop
      title="Drop to read"
      hint="Add a PDF or EPUB to your library"
      onFiles={(files) => {
        const file = firstDocument(files) ?? files[0];
        if (file) onFile(file);
      }}
    />
  );
}
