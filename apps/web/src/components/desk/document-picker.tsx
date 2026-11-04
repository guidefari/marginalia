"use client";
import { useRef } from "react";

export function DocumentPickerButton({
  onFile,
  className,
  children,
}: {
  onFile: (file: File) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,application/epub+zip,.epub"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still fires
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        className={className}
        onClick={() => input.current?.click()}
      >
        {children}
      </button>
    </>
  );
}
