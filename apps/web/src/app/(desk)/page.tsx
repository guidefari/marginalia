"use client";
import { lazy, Suspense } from "react";

// The auth gate does not mount this route until reader access is confirmed.
const Desk = lazy(() => import("@/components/desk/desk"));

export default function DeskRoute() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[760px] p-6" role="status">
          Opening your desk…
        </main>
      }
    >
      <Desk />
    </Suspense>
  );
}
