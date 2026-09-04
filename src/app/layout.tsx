import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Sparkles, Newspaper, ShieldCheck, Activity } from 'lucide-react';

export const metadata: Metadata = {
  title: 'NAKSHATRA | Autonomous AI Intelligence & Verified News Platform',
  description:
    'Evidence-grounded autonomous AI news reporting. Every claim verified against primary lab documentation with zero hallucinations and real-time observability.',
  metadataBase: new URL('http://localhost:3000'),
  openGraph: {
    title: 'NAKSHATRA | Autonomous AI Intelligence Platform',
    description: 'Evidence-backed, autonomous reporting on frontier AI breakthroughs.',
    siteName: 'NAKSHATRA',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
        {/* Main Navigation Header */}
        <header className="sticky top-0 z-50 backdrop-blur-md bg-[#090d16]/85 border-b border-slate-800/80 px-4 lg:px-8 py-3.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-500 via-indigo-500 to-purple-500 p-0.5 flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
                <div className="w-full h-full bg-slate-950 rounded-[7px] flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold tracking-wider text-lg gradient-title font-mono">
                  NAKSHATRA
                </span>
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold -mt-1">
                  Autonomous AI Intelligence
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-2 sm:gap-4 text-sm font-medium">
              <Link
                href="/"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <Newspaper className="w-4 h-4 text-sky-400" />
                <span className="hidden sm:inline">Live Feed</span>
              </Link>
              <Link
                href="/admin/newsroom"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">Newsroom Admin</span>
              </Link>
              <Link
                href="/admin/observability"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <Activity className="w-4 h-4 text-purple-400" />
                <span className="hidden sm:inline">Observability</span>
              </Link>
            </nav>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-800/80 bg-slate-950/60 py-8 px-4 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>
              ? 2026 NAKSHATRA. Autonomous, evidence-grounded AI journalism. Primary source attributions guaranteed.
            </p>
            <div className="flex items-center gap-4 text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Autonomous Agents Operational
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
