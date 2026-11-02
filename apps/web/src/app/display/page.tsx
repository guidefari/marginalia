import type { Metadata } from "next";
import { ReadingDisplay } from "@/components/reading-display";

export const metadata: Metadata = {
  title: "Reading display · Marginalia",
  robots: { index: false, follow: false },
};

export default function DisplayPage() {
  return <ReadingDisplay />;
}
