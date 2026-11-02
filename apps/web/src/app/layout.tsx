import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible,
  Cinzel_Decorative,
  DM_Sans,
  JetBrains_Mono,
  Literata,
  Newsreader,
  UnifrakturMaguntia,
} from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { InteractionFeedback } from "@/components/interaction-feedback";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { PwaRuntime } from "@/components/pwa-runtime";
import { ReaderRoomMemory } from "@/components/reader-room-memory";
import { ConvexClientProvider } from "@/lib/convex";
import { AltHintProvider } from "@/lib/use-alt-hint";
import "./globals.css";
import "@planetaryescape/reader/reader.css";

// Self-hosted by next/font: Turbopack drops remote CSS @imports, so Google
// Fonts must not be loaded from globals.css.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-newsreader",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-dm-sans",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});
// Optional reading fonts load only when chosen in the Text settings
const literata = Literata({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-literata",
  preload: false,
});
const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-atkinson",
  preload: false,
});
const cinzelDecorative = Cinzel_Decorative({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-cinzel-decorative",
  preload: false,
});
const unifraktur = UnifrakturMaguntia({
  weight: "400",
  variable: "--font-unifraktur",
  preload: false,
});

const fontVariables = [
  newsreader,
  dmSans,
  jetbrainsMono,
  literata,
  atkinson,
  cinzelDecorative,
  unifraktur,
]
  .map((font) => font.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "Marginalia",
  description:
    "A personal reading desk with contextual marginalia, notes and a searchable library.",
  applicationName: "Marginalia",
  appleWebApp: {
    capable: true,
    title: "Marginalia",
    statusBarStyle: "default",
  },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#201d1b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={fontVariables}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AltHintProvider>
            <ConvexClientProvider>
              <a href="#main-content" className="skip-link">
                Skip to content
              </a>
              <div
                id="main-content"
                tabIndex={-1}
                className="min-h-screen outline-none"
              >
                {children}
              </div>
              <Toaster position="bottom-center" />
              <KeyboardShortcuts />
            </ConvexClientProvider>
          </AltHintProvider>
          <PwaRuntime />
          <InteractionFeedback />
          <ReaderRoomMemory />
        </ThemeProvider>
      </body>
    </html>
  );
}
