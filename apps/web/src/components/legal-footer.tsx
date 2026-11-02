import Link from "next/link";

export function LegalFooter({
  openInNewTab = false,
}: {
  openInNewTab?: boolean;
}) {
  return (
    <footer className="shrink-0 border-t border-[var(--reader-border)] px-5 md:px-10">
      <nav
        aria-label="Legal"
        className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-x-6 text-sm text-[var(--reader-fg-soft)]"
      >
        <Link
          href="/privacy"
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noopener noreferrer" : undefined}
          className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Privacy Policy
          {openInNewTab && " (new tab)"}
        </Link>
        <Link
          href="/terms"
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noopener noreferrer" : undefined}
          className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Terms of Service
          {openInNewTab && " (new tab)"}
        </Link>
      </nav>
    </footer>
  );
}
