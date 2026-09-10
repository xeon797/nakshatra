import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Newspaper, ShieldCheck, Activity } from 'lucide-react';
import { Hind_Siliguri, Inter } from 'next/font/google';
import { LanguageProvider } from '../context/language-context';
import { LanguageToggle } from '../components/common/LanguageToggle';

import { Logo } from '../components/brand/Logo';

const hindSiliguri = Hind_Siliguri({
  weight: ['400', '500', '600', '700'],
  subsets: ['bengali'],
  variable: '--font-bengali',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: 'NAKSHATRA | Autonomous AI Intelligence & Verified News Platform',
  description:
    'Evidence-grounded autonomous AI news reporting. Every claim verified against primary lab documentation with zero hallucinations and real-time observability.',
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
    <html lang="bn" className={`${hindSiliguri.variable} ${inter.variable}`}>
      <body className="min-h-screen flex flex-col bg-[#fdfcf3] text-[#120424] font-sans antialiased">
        <LanguageProvider>
          {/* Main Navigation Header */}
          <header className="sticky top-0 z-50 bg-[#ffffff] border-b border-[#d9d9d9] px-4 lg:px-8 py-3">
            <div className="max-w-[1240px] mx-auto flex items-center justify-between">
              <Logo size="md" />

              <div className="flex items-center gap-2 sm:gap-4">
                <nav className="flex items-center gap-1 sm:gap-3 text-xs uppercase tracking-wider font-semibold font-display">
                  <Link
                    href="/"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[#120424] hover:bg-[#fdfbe4] border border-transparent hover:border-[#d9d9d9] transition-colors"
                    style={{ borderRadius: 0 }}
                  >
                    <Newspaper className="w-3.5 h-3.5 text-[#1e0a3c]" />
                    <span className="hidden sm:inline">Live Feed</span>
                  </Link>
                  <Link
                    href="/admin/newsroom"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[#120424] hover:bg-[#fdfbe4] border border-transparent hover:border-[#d9d9d9] transition-colors"
                    style={{ borderRadius: 0 }}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
                    <span className="hidden sm:inline">Newsroom</span>
                  </Link>
                  <Link
                    href="/admin/observability"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[#120424] hover:bg-[#fdfbe4] border border-transparent hover:border-[#d9d9d9] transition-colors"
                    style={{ borderRadius: 0 }}
                  >
                    <Activity className="w-3.5 h-3.5 text-[#1e0a3c]" />
                    <span className="hidden sm:inline">Observability</span>
                  </Link>
                </nav>

                <LanguageToggle />

                <a
                  href="#newsletter-subscribe"
                  className="hidden md:inline-flex items-center justify-center px-3.5 py-1.5 bg-[#d91b74] hover:bg-[#bf1363] text-white text-xs font-bold uppercase tracking-wider font-display transition-colors"
                  style={{ borderRadius: 0 }}
                >
                  SUBSCRIBE
                </a>
              </div>
            </div>
          </header>

          {/* Content Body */}
          <main className="flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>

          {/* Footer */}
          <footer className="border-t border-[#d9d9d9] bg-[#ffffff] py-8 px-4 text-center text-xs text-[#6e6e6e] font-mono">
            <div className="max-w-[1240px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
              <p>
                &copy; 2026 NAKSHATRA. Autonomous, evidence-grounded AI journalism. Primary source attributions guaranteed.
              </p>
              <div className="flex items-center gap-4 text-[#120424]">
                <span className="inline-flex items-center gap-1.5 font-bold uppercase">
                  <span className="w-2 h-2 bg-[#d91b74] animate-pulse" />
                  Autonomous Agents Operational
                </span>
              </div>
            </div>
          </footer>
        </LanguageProvider>
      </body>
    </html>
  );
}
