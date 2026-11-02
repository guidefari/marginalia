"use client";
import { lazy, Suspense, useEffect, useState } from "react";
import { consumeFinderRequest } from "@/lib/finder-request";
import { arrivedFromFinish } from "@/lib/title-handoff";

// The auth gate does not mount this route until reader access is confirmed.
const Desk = lazy(() => import("@/components/desk/desk"));

export default function DeskRoute() {
  // Capture the handoff before a slow first chunk load can expire its window.
  const [fromFinish] = useState(() => arrivedFromFinish());
  useEffect(
    () => () => {
      // A Search tap belongs to this visit, not a later return to the desk.
      consumeFinderRequest();
    },
    [],
  );
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
