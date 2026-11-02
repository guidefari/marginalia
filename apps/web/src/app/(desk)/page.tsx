"use client";
import { lazy, Suspense, useState } from "react";
import { arrivedFromFinish } from "@/lib/title-handoff";

// The auth gate does not mount this route until reader access is confirmed.
const Desk = lazy(() => import("@/components/desk/desk"));

export default function DeskRoute() {
  // Capture the handoff before a slow first chunk load can expire its window.
  const [fromFinish] = useState(() => arrivedFromFinish());
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[760px] p-6" role="status">
          Opening your desk…
        </main>
      }
    >
      <Desk fromFinish={fromFinish} />
    </Suspense>
  );
}
