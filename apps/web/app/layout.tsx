import type { Metadata } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "CineMind",
  description: "A self-hosted recommendation engine that learns your taste in film and TV.",
};

const NAV = [
  { href: "/", label: "For you" },
  { href: "/ask", label: "Ask" },
  { href: "/library", label: "Library" },
  { href: "/taste", label: "Taste" },
  { href: "/connections", label: "Connections" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${inter.variable}`}>
      <body className="antialiased">
        <header className="sticky top-0 z-10 border-b border-line/70 bg-ink/80 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
            <Link href="/" className="font-display text-2xl tracking-tight">
              Cine<span className="text-amber">Mind</span>
            </Link>
            <ul className="flex gap-1 overflow-x-auto text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="rounded-full px-3 py-1.5 text-muted transition hover:bg-panel hover:text-paper">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-muted sm:px-6">
          This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. Information courtesy of IMDb (imdb.com), used under its non-commercial terms.
        </footer>
      </body>
    </html>
  );
}
