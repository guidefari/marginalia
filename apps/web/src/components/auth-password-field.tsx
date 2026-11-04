"use client";

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
      <div className="mt-2 flex gap-2">
        <input
          id={id}
          className="app-input min-w-0 flex-1"
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
          className="min-h-11 min-w-16 shrink-0 rounded-md px-3 text-sm text-[var(--reader-fg-soft)]"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={id}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide" : "Show"}
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
