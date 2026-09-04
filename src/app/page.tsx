import Link from 'next/link';
import { ArticleManager } from '../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../db/init';
import { ShieldCheck, Clock, ArrowRight, Sparkles, ExternalLink } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  await ensureDatabaseInitialized();

  const articleManager = new ArticleManager();
  const publishedArticles = await articleManager.getPublishedArticles(20, 0);

  return (
    <div className="space-y-10">
      {/* Platform Hero Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-indigo-950/40 border border-slate-800 p-8 sm:p-12 shadow-2xl">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            Zero-Hallucination Newsroom
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Autonomous Frontier AI News, <br />
            <span className="gradient-title">100% Evidence-Grounded.</span>
          </h1>
          <p className="text-slate-300 text-base sm:text-lg leading-relaxed">
            NAKSHATRA ingests primary releases from top AI laboratories, extracts atomic claims, verifies facts against official documentation, and synthesizes original analytical reporting with zero verbatim plagiarism.
          </p>
        </div>
      </section>

      {/* Main News Stream */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Verified Intelligence Feed</h2>
            <p className="text-xs text-slate-400">Strictly verified against primary technical reports and announcements</p>
          </div>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            {publishedArticles.length} Published Articles
          </span>
        </div>

        {publishedArticles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center space-y-4 bg-slate-950/30">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <ShieldCheck className="w-6 h-6 text-sky-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">No published articles yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              The autonomous pipeline continuously ingests and verifies news in the background. Visit the Newsroom Admin deck to inspect pending drafts or trigger an ingestion run!
            </p>
            <div className="pt-2">
              <Link
                href="/admin/newsroom"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm hover:bg-sky-400 transition-colors shadow-lg shadow-sky-500/25"
              >
                Open Newsroom Deck
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {publishedArticles.map((article) => {
              const confidencePercent = Math.round(parseFloat(article.confidenceScore) * 100);
              return (
                <article
                  key={article.id}
                  className="card-hover flex flex-col justify-between rounded-xl bg-slate-900/70 border border-slate-800/90 p-6 shadow-sm"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {confidencePercent}% Grounded
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        {article.readingTimeMinutes} min read
                      </span>
                    </div>

                    <h3 className="text-xl font-bold text-white hover:text-sky-400 transition-colors leading-snug">
                      <Link href={`/article/${article.slug}`}>
                        {article.title}
                      </Link>
                    </h3>

                    <p className="text-slate-400 text-sm line-clamp-3 leading-relaxed">
                      {article.deck}
                    </p>
                  </div>

                  <div className="pt-5 mt-4 border-t border-slate-800/60 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-mono">
                      {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : 'Recent'}
                    </span>
                    <Link
                      href={`/article/${article.slug}`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300"
                    >
                      Read & Verify Evidence
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
