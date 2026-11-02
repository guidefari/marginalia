"use client";
import { usePathname } from "next/navigation";
import { lazy, type ReactNode, Suspense } from "react";
import { LegalFooter } from "@/components/legal-footer";
import { useReaderSettings } from "@/lib/reader-settings";
import { useReaderTheme } from "@/lib/use-reader-theme";

const SiteHeader = lazy(() =>
  import("@/components/site-header").then((module) => ({
    default: module.SiteHeader,
  })),
);
const MobileNav = lazy(() =>
  import("@/components/site-header").then((module) => ({
    default: module.MobileNav,
  })),
);

/** Persistent chrome for every destination in the desk frame. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const pathname = usePathname();

  return (
    <div className="desk-shell h-dvh flex flex-col overflow-hidden bg-[var(--reader-bg)] text-[var(--reader-fg)] font-sans">
      <Suspense
        fallback={<div aria-hidden="true" className="shrink-0 h-14 md:h-16" />}
      >
        <SiteHeader />
      </Suspense>
      <div
        className="desk-route flex-1 min-h-0 overflow-y-auto overscroll-contain"
        data-route={pathname}
      >
        {children}
      </div>
      <LegalFooter />
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
