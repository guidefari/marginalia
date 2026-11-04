"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_HINT,
} from "@/lib/auth-registration";

export function AuthPasswordField({
  signingUp,
  error,
  onInput,
}: {
  signingUp: boolean;
  error: string;
  onInput: () => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [signingUp ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="text-sm">
      <label htmlFor={id}>Password</label>
      <div className="app-input mt-2 !flex items-center !p-0 focus-within:outline focus-within:outline-1 focus-within:outline-offset-2 focus-within:outline-[var(--reader-border-strong)]">
        <input
          id={id}
          className="min-w-0 flex-1 rounded-l-[9px] bg-transparent px-3 py-2.5 text-base !outline-none"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={signingUp ? "new-password" : "current-password"}
          minLength={signingUp ? MIN_PASSWORD_LENGTH : undefined}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onInput={onInput}
          required
        />
        <button
          type="button"
          className="mr-px flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={id}
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <EyeOff size={18} aria-hidden />
          ) : (
            <Eye size={18} aria-hidden />
          )}
        </button>
      </div>
      {signingUp && (
        <p id={hintId} className="mt-2 text-[var(--reader-muted)]">
          {PASSWORD_LENGTH_HINT}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
