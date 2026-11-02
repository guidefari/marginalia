"use client";
import { Home, Library, NotebookPen, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { requestFinder } from "@/lib/finder-request";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The rooms in the header and on the phone bar. Desk is the wordmark. Your
 * reading is never linked from the reader or Notes (D-DES-060).
 */
export const ROOMS: NavItem[] = [
  { href: "/library", label: "Library" },
  { href: "/notes", label: "Notes" },
  { href: "/reading", label: "Your reading" },
];

/**
 * The settings pages name themselves here instead of in their own column, so
 * the page title is the only heading a settings page has.
 */
export const SETTINGS_PAGES: Record<string, string> = {
  "/feeds": "Sources",
  "/readers": "Readers",
  "/account": "Account",
};

/** A room is current on its own path and anything beneath it. */
export function isCurrentRoom(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Wordmark, the three rooms and the account menu, shared by the desk frame. */
export function SiteHeader() {
  const pathname = usePathname();
  const settingsPage = SETTINGS_PAGES[pathname];
  return (
    <header className="shrink-0 mx-auto w-full max-w-[1180px] px-5 md:px-10 h-14 md:h-16 flex items-center gap-4 md:gap-6">
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        className={roomClass}
      >
        Marginalia
      </Link>
      <nav
        aria-label="Main navigation"
        className="hidden md:flex items-center gap-6 text-[13px] text-[var(--reader-muted)]"
      >
        {ROOMS.map((room) => {
          const current = isCurrentRoom(pathname, room.href);
          return (
            <Link
              key={room.href}
              href={room.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "hover:text-[var(--reader-fg)] transition-colors",
                current &&
                  "text-[var(--reader-fg)] underline underline-offset-[8px] decoration-[var(--reader-border-strong)]",
              )}
            >
              {room.label}
            </Link>
          );
        })}
      </nav>
      {settingsPage && (
        <p className="ml-auto min-w-0 truncate text-[13px] text-[var(--reader-muted)]">
          Settings · {settingsPage}
        </p>
      )}
      <div className={cn("flex items-center", !settingsPage && "ml-auto")}>
        <AccountMenu />
      </div>
    </header>
  );
}

const roomClass =
  "font-serif text-[21px] md:text-[22px] tracking-tight shrink-0 aria-[current=page]:underline aria-[current=page]:underline-offset-[8px] aria-[current=page]:decoration-[var(--reader-border-strong)]";

/**
 * Search opens the picker. The picker lives on the desk, so from another room
 * Search goes to the desk and opens it there.
 */
function useOpenFinder(pathname: string) {
  const router = useRouter();
  return () => {
    if (pathname === "/") requestFinder();
    else router.push("/?find=1");
  };
}

/** Four slots: Desk, Library, Notes and Search. Your reading stays in the header. */
export function MobileNav() {
  const pathname = usePathname();
  const openFinder = useOpenFinder(pathname);
  const slots = [
    { href: "/", label: "Desk", Icon: Home },
    { href: "/library", label: "Library", Icon: Library },
    { href: "/notes", label: "Notes", Icon: NotebookPen },
  ];
  const slotClass =
    "flex flex-col min-h-14 min-w-0 items-center justify-center gap-1 px-0.5 text-center whitespace-nowrap hover:text-[var(--reader-fg)] aria-[current=page]:text-[var(--reader-fg)]";
  return (
    <nav
      aria-label="Main navigation"
      className="mobile-app-nav md:hidden shrink-0 px-1 pb-[env(safe-area-inset-bottom)] grid grid-cols-4 border-t border-[var(--reader-border)] bg-[var(--reader-surface)] text-[11px] text-[var(--reader-muted)]"
    >
      {slots.map(({ href, label, Icon }) => {
        const current =
          href === "/" ? pathname === "/" : isCurrentRoom(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={slotClass}
          >
            <Icon size={20} strokeWidth={current ? 2.25 : 1.6} aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        aria-keyshortcuts="/"
        onClick={openFinder}
        className={slotClass}
      >
        <Search size={20} strokeWidth={1.6} aria-hidden />
        <span>Search</span>
      </button>
    </nav>
  );
}
