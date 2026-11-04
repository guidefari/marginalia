"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Fingerprint, LockKeyhole } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { AuthPasswordField } from "@/components/auth-password-field";
import { LegalFooter } from "@/components/legal-footer";
import { PageGoalCelebration } from "@/components/page-goal";
import { ReaderOpening } from "@/components/reader-opening";
import { SourceLink } from "@/components/source-link";
import { authClient } from "@/lib/auth-client";
import {
  type RegistrationIssue,
  registrationFailure,
  registrationPasswordIssue,
} from "@/lib/auth-registration";
import { rearmAuth } from "@/lib/auth-retry";
import {
  LINE_HEIGHTS,
  MAX_WIDTHS,
  TYPEFACE_FAMILIES,
  useReaderSettings,
} from "@/lib/reader-settings";
import { useReaderTheme } from "@/lib/use-reader-theme";

export const ALREADY_SIGNED_IN =
  "You're already signed in. Sign out to use an invite link.";

export interface FragmentTokens {
  invite: string;
  setup: string;
}

interface AccessRequestDraft {
  email: string;
  name: string;
  note: string;
}

type AccessRequestDraftUpdater = Dispatch<
  SetStateAction<AccessRequestDraft | null>
>;

interface AccessRequestDraftState {
  requestDraft: AccessRequestDraft | null;
  onRequestDraftChange: AccessRequestDraftUpdater;
}

/**
 * Takes the one-time #invite= and #setup= tokens from the URL and removes
 * the fragment, keeping the path and query, so they never linger in history.
 */
export function takeFragmentTokens(
  win: Pick<Window, "location" | "history">,
): FragmentTokens {
  const params = new URLSearchParams(win.location.hash.slice(1));
  if (params.has("invite") || params.has("setup"))
    win.history.replaceState(
      null,
      "",
      win.location.pathname + win.location.search,
    );
  return {
    invite: params.get("invite") ?? "",
    setup: params.get("setup") ?? "",
  };
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const pathname = usePathname();
  // This gate stays mounted across public notices and background auth checks.
  // Keep only the access-request draft here, never passwords or browser storage.
  const [requestDraft, setRequestDraft] = useState<AccessRequestDraft | null>(
    null,
  );
  // Only these static notices are public; every reading route stays gated.
  if (
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/help/deep-study"
  )
    return children;
  return (
    <ReaderAccessGate
      requestDraft={requestDraft}
      onRequestDraftChange={setRequestDraft}
    >
      {children}
    </ReaderAccessGate>
  );
}

function ReaderAccessGate({
  children,
  requestDraft,
  onRequestDraftChange,
}: { children: ReactNode } & AccessRequestDraftState) {
  const pathname = usePathname();
  const { settings } = useReaderSettings();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (isAuthenticated) onRequestDraftChange(null);
  }, [isAuthenticated, onRequestDraftChange]);
  // Better Auth's own answer: a session here while Convex says signed out
  // means a token fetch failed, not that the reader signed out
  const { data: session } = authClient.useSession();
  const stalled = !isLoading && !isAuthenticated && Boolean(session);
  const slow = useAfter(isLoading, SLOW_MS);
  const reader = useQuery(
    api.auth.currentReader,
    isAuthenticated ? {} : "skip",
  );
  // Stripped on every load, signed in or not; only sign-up uses them
  const [fragment, setFragment] = useState<FragmentTokens | null>(null);
  const fragmentCaptured = useRef(false);
  useEffect(() => {
    if (fragmentCaptured.current) return;
    fragmentCaptured.current = true;
    setFragment(takeFragmentTokens(window));
  }, []);
  const checked = useRef(false);
  useEffect(() => {
    if (!fragment || isLoading) return;
    // An invite opened while signed in is never sent anywhere
    if (!checked.current && isAuthenticated && fragment.invite)
      toast(ALREADY_SIGNED_IN);
    checked.current = true;
    if (isAuthenticated) setFragment(null);
  }, [fragment, isLoading, isAuthenticated]);
  if (stalled) return <Reconnect />;
  if (
    (isLoading || (isAuthenticated && reader === undefined)) &&
    pathname.startsWith("/read/")
  )
    return (
      <>
        <ReaderOpening
          articleId="auth-pending"
          title=""
          label="Opening your reader…"
          columnStyle={
            {
              maxWidth: MAX_WIDTHS[settings.width],
              "--reader-font": TYPEFACE_FAMILIES[settings.typeface],
              "--reader-size": `${settings.size}px`,
              "--reader-leading": LINE_HEIGHTS[settings.spacing],
            } as CSSProperties
          }
        />
        {slow && (
          <button
            type="button"
            className="fixed bottom-6 left-6 text-sm underline"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        )}
      </>
    );
  if (isLoading || (isAuthenticated && reader === undefined))
    return (
      <div className="auth-screen" role="status">
        Opening your reader…
        {slow && (
          <button
            type="button"
            className="mt-6 text-sm underline decoration-[var(--pencil-rule)] underline-offset-4"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        )}
      </div>
    );
  if (isAuthenticated && reader)
    return (
      <>
        {children}
        <PageGoalCelebration />
      </>
    );
  if (isAuthenticated)
    return (
      <main className="auth-screen">
        <div className="w-full max-w-sm">
          <p className="font-serif text-2xl mb-10">Marginalia</p>
          <h1 className="font-serif text-3xl mb-3">No access right now</h1>
          <p className="text-sm text-[var(--reader-muted)] mb-7">
            This account can't open the reader. It may have been disabled, or it
            was never approved. Sign out to use a different account.
          </p>
          <button
            className="app-button w-full"
            onClick={() => authClient.signOut()}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  return (
    <SignIn
      fragment={fragment}
      requestDraft={requestDraft}
      onRequestDraftChange={onRequestDraftChange}
    />
  );
}

/** How long opening may take before a way to try again appears. */
const SLOW_MS = 10_000;
/** How long a reconnect waits before trying by itself. */
const AUTO_RETRY_MS = 3_000;

/** True once `active` has held for `ms`; false again as soon as it stops. */
function useAfter(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!active) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return late;
}

/**
 * Signed in, but the library connection lost its token (a deploy switching
 * over, a sleeping laptop, a dropped network). Tries once by itself, then
 * offers to, rather than asking the reader to sign in again.
 */
// The screen remounts each time a retry fails, so the count lives outside it
let autoRetries = 0;
const MAX_AUTO_RETRIES = 2;
const RELOAD_KEY = "marginalia:reconnect-reload";
const RELOAD_EVERY_MS = 60_000;

/**
 * Re-arming Convex auth fixes a token lost in passing; a page whose
 * connection stays refused after that recovers on a full reload (seen live
 * after a deploy). Reloads at most once a minute, so it can never loop.
 */
export function reloadOnce(
  storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage,
  reload: () => void = () => window.location.reload(),
  now = Date.now(),
): boolean {
  let last = 0;
  try {
    last = Number(storage.getItem(RELOAD_KEY) ?? 0);
  } catch {}
  if (now - last < RELOAD_EVERY_MS) return false;
  try {
    storage.setItem(RELOAD_KEY, String(now));
  } catch {}
  reload();
  return true;
}

function Reconnect() {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (autoRetries < MAX_AUTO_RETRIES) {
        autoRetries++;
        rearmAuth();
      } else reloadOnce();
    }, AUTO_RETRY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="auth-screen" role="status">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <p className="text-sm text-[var(--reader-muted)] mb-7">
          Reconnecting to your library…
        </p>
        <button
          type="button"
          className="app-button w-full"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
        {/* If the library keeps refusing this session, signing in afresh is the way out */}
        <button
          type="button"
          className="mt-4 w-full text-sm text-[var(--reader-muted)] underline decoration-[var(--pencil-rule)] underline-offset-4"
          onClick={() => authClient.signOut()}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

function SignIn({
  fragment,
  requestDraft,
  onRequestDraftChange,
}: { fragment: FragmentTokens | null } & AccessRequestDraftState) {
  const [setup, setSetup] = useState("");
  const [invite, setInvite] = useState("");
  const [requesting, setRequesting] = useState(requestDraft !== null);
  const [passwordForm, setPasswordForm] = useState(false);
  const [factor, setFactor] = useState(false);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] =
    useState<RegistrationIssue["field"]>(null);
  const emailErrorId = useId();
  useEffect(() => {
    if (!fragment) return;
    const invited = fragment.invite;
    const owner = invited ? "" : fragment.setup;
    if (invited) setInvite(invited);
    if (owner) setSetup(owner);
    if (invited || owner) setPasswordForm(true);
  }, [fragment]);
  const signingUp = Boolean(setup || invite);
  const formRef = useRef<HTMLFormElement>(null);
  const passkeyRef = useRef<HTMLButtonElement>(null);
  const step =
    requesting && !signingUp
      ? "request"
      : factor
        ? backup
          ? "recovery"
          : "authenticator"
        : passwordForm
          ? "password"
          : "passkey";
  const previousStep = useRef(step);
  useEffect(() => {
    // Move focus only when the reader changes steps, not on load or errors.
    if (previousStep.current === step) return;
    previousStep.current = step;
    const target =
      formRef.current?.querySelector<HTMLInputElement>("input") ??
      passkeyRef.current;
    target?.focus();
  }, [step]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const showIssue = (issue: RegistrationIssue) => {
      setError(issue.message);
      setErrorField(issue.field);
      if (issue.field)
        form
          .querySelector<HTMLInputElement>(`input[name="${issue.field}"]`)
          ?.focus();
    };
    if (signingUp && !factor) {
      const issue = registrationPasswordIssue(
        String(fields.get("password") ?? ""),
      );
      if (issue) {
        showIssue(issue);
        return;
      }
    }
    setBusy(true);
    setError("");
    setErrorField(null);
    try {
      if (factor) {
        const code = String(fields.get("code") ?? "").trim();
        const result = backup
          ? await authClient.twoFactor.verifyBackupCode({ code })
          : await authClient.twoFactor.verifyTotp({ code });
        if (result.error) {
          setError(
            "That code wasn't accepted. Try a fresh code or a recovery code.",
          );
          return;
        }
      } else {
        const email = String(fields.get("email") ?? "").trim();
        const password = String(fields.get("password") ?? "");
        const name = String(fields.get("name") ?? "").trim();
        const result = signingUp
          ? await authClient.signUp.email({
              email,
              password,
              name: invite ? name || email : "Reader owner",
              fetchOptions: {
                headers: invite
                  ? { "x-reader-invite": invite }
                  : { "x-reader-setup": setup },
              },
            })
          : await authClient.signIn.email({ email, password });
        if (result.error) {
          if (signingUp)
            showIssue(
              registrationFailure(result.error, invite ? "invite" : "owner"),
            );
          else
            setError(
              "Couldn't sign in. Check your email and password, or try your passkey.",
            );
          return;
        }
        if (
          result.data &&
          "twoFactorRedirect" in result.data &&
          result.data.twoFactorRedirect
        )
          setFactor(true);
        else {
          setSetup("");
          setInvite("");
        }
      }
    } catch {
      setError(
        "Couldn't reach the sign-in service. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (requesting && !signingUp)
    return (
      <RequestAccess
        initialDraft={requestDraft}
        onDraftChange={onRequestDraftChange}
        onBack={() => {
          onRequestDraftChange(null);
          setRequesting(false);
        }}
      />
    );
  return (
    <main className="auth-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <LockKeyhole size={24} className="mb-4 text-[var(--reader-muted)]" />
        <h1 className="font-serif text-3xl mb-3">
          {invite
            ? "Set up your reader"
            : setup
              ? "Make this reader yours"
              : factor
                ? "One more check"
                : "Your reading desk"}
        </h1>
        <p className="text-sm text-[var(--reader-muted)] mb-7">
          {signingUp
            ? "Choose your fallback password. Add a passkey after signing in for quicker access next time."
            : factor
              ? "Enter your authenticator code, or use a saved recovery code."
              : "Sign in to return to your articles and notes."}
        </p>
        {!passwordForm && !factor && (
          <button
            ref={passkeyRef}
            disabled={busy}
            className="app-button w-full mb-4"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await authClient.signIn.passkey();
                if (result.error)
                  setError(
                    "Passkey sign-in didn't complete. Try again or use your password.",
                  );
              } catch {
                setError(
                  "Passkeys aren't available here. Use your password instead.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Fingerprint size={20} />
            {busy ? "Signing in…" : "Continue with a passkey"}
          </button>
        )}
        {(passwordForm || factor) && (
          <form
            ref={formRef}
            onSubmit={submit}
            aria-busy={busy}
            className="space-y-4"
          >
            {factor ? (
              <label className="block text-sm">
                {backup ? "Recovery code" : "Authenticator code"}
                <input
                  className="app-input mt-2"
                  name="code"
                  autoComplete="one-time-code"
                  inputMode={backup ? "text" : "numeric"}
                  required
                />
              </label>
            ) : (
              <>
                {invite && (
                  <label className="block text-sm">
                    Your name
                    <input
                      className="app-input mt-2"
                      name="name"
                      autoComplete="name"
                      maxLength={100}
                      required
                    />
                  </label>
                )}
                <label className="block text-sm">
                  Email
                  <input
                    className="app-input mt-2"
                    name="email"
                    type="email"
                    autoComplete="username webauthn"
                    aria-invalid={errorField === "email" ? true : undefined}
                    aria-describedby={
                      errorField === "email" ? emailErrorId : undefined
                    }
                    onInput={() => {
                      if (errorField === "email") {
                        setError("");
                        setErrorField(null);
                      }
                    }}
                    required
                  />
                </label>
                {errorField === "email" && (
                  <p id={emailErrorId} role="alert" className="text-sm">
                    {error}
                  </p>
                )}
                <AuthPasswordField
                  signingUp={signingUp}
                  error={errorField === "password" ? error : ""}
                  onInput={() => {
                    if (errorField === "password") {
                      setError("");
                      setErrorField(null);
                    }
                  }}
                />
              </>
            )}
            <button className="app-button w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : invite
                  ? "Create my account"
                  : setup
                    ? "Claim my reader"
                    : factor
                      ? "Verify and sign in"
                      : "Sign in"}
            </button>
          </form>
        )}
        {!signingUp && (
          <button
            disabled={busy}
            className="min-h-11 w-full text-sm text-[var(--reader-muted)] mt-2"
            onClick={() => {
              if (factor) setBackup(!backup);
              else setPasswordForm(!passwordForm);
              setError("");
            }}
          >
            {factor
              ? backup
                ? "Use an authenticator code"
                : "Use a recovery code"
              : passwordForm
                ? "Use a passkey instead"
                : "Use email and password"}
          </button>
        )}
        {!signingUp && !factor && (
          <button
            disabled={busy}
            className="min-h-11 w-full text-sm text-[var(--reader-muted)]"
            onClick={() => {
              onRequestDraftChange({ email: "", name: "", note: "" });
              setRequesting(true);
              setError("");
            }}
          >
            Request access
          </button>
        )}
        {error && !errorField && (
          <p role="alert" className="mt-4 text-sm text-[var(--reader-fg)]">
            {error}
          </p>
        )}
      </div>
      <SourceLink className="mt-10" />
      <LegalFooter />
    </main>
  );
}

export function RequestAccess({
  onBack,
  initialDraft,
  onDraftChange,
}: {
  onBack: () => void;
  initialDraft?: AccessRequestDraft | null;
  onDraftChange?: AccessRequestDraftUpdater;
}) {
  const request = useMutation(api.waitlist.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => emailRef.current?.focus(), []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    const submittedDraft = initialDraft ?? null;
    try {
      const result = await request({
        email: String(fields.get("email") ?? ""),
        name: String(fields.get("name") ?? ""),
        note: String(fields.get("note") ?? "") || undefined,
      });
      // A later request or edit must not be cleared by this completion.
      onDraftChange?.((current) =>
        current === submittedDraft ? null : current,
      );
      setDone(result.message);
    } catch (e) {
      setError(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : "Couldn't send your request. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <h1 className="font-serif text-3xl mb-3">Request access</h1>
        {done ? (
          <p role="status" className="text-sm mb-7">
            {done}
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--reader-muted)] mb-7">
              Marginalia is a small, invite-only reader. Leave your details and
              the owner may send you an invite.
            </p>
            <form
              onSubmit={submit}
              onInput={(event) => {
                const fields = new FormData(event.currentTarget);
                onDraftChange?.({
                  email: String(fields.get("email") ?? ""),
                  name: String(fields.get("name") ?? ""),
                  note: String(fields.get("note") ?? ""),
                });
              }}
              className="space-y-4"
            >
              <label className="block text-sm">
                Email
                <input
                  ref={emailRef}
                  className="app-input mt-2"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={initialDraft?.email ?? ""}
                  maxLength={254}
                  required
                />
              </label>
              <label className="block text-sm">
                Name
                <input
                  className="app-input mt-2"
                  name="name"
                  autoComplete="name"
                  defaultValue={initialDraft?.name ?? ""}
                  maxLength={100}
                  required
                />
              </label>
              <label className="block text-sm">
                What you'd like to read with it{" "}
                <span className="text-[var(--reader-muted)]">(optional)</span>
                <textarea
                  className="app-input mt-2"
                  name="note"
                  defaultValue={initialDraft?.note ?? ""}
                  rows={3}
                  maxLength={500}
                />
              </label>
              <button className="app-button w-full" disabled={busy}>
                {busy ? "Sending…" : "Request access"}
              </button>
            </form>
          </>
        )}
        <button
          className="min-h-11 w-full text-sm text-[var(--reader-muted)] mt-2"
          onClick={onBack}
        >
          Back to sign in
        </button>
        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--reader-fg)]">
            {error}
          </p>
        )}
      </div>
      <SourceLink className="mt-10" />
      <LegalFooter />
    </main>
  );
}
