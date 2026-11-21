import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "LendLoop — Borrow what you need. Lend what you don't.",
  description: "A neighbourhood tool-lending board.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <ClerkProvider>
          <ConvexClientProvider>
            <SiteHeader />
            <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8">{children}</main>
            <footer className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6 text-xs text-muted">
                <span className="font-display text-base text-ink-soft">LendLoop</span>
                <span>A fictional neighbourhood lending board</span>
              </div>
            </footer>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
