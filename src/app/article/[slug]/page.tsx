import { notFound } from 'next/navigation';
import { ArticleManager } from '../../../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../../../db/init';
import Link from 'next/link';
import { ShieldCheck, Clock, ExternalLink, ArrowLeft, Bookmark } from 'lucide-react';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

function renderParagraphWithCitations(paragraph: string) {
  const parts = paragraph.split(/(\[\^?\d+\])/g);
  return parts.map((part, index) => {
    const match = part.match(/\[\^?(\d+)\]/);
    if (match) {
      const citNum = match[1];
      return (
        <sup key={index} id={`ref-${citNum}`} className="scroll-mt-24">
          <a
            href={`#citation-${citNum}`}
            className="text-sky-400 hover:text-sky-300 font-mono text-xs font-semibold px-0.5 hover:underline"
            title={`Jump to verified source citation [${citNum}]`}
          >
            [{citNum}]
          </a>
        </sup>
      );
    }
    return part;
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await ensureDatabaseInitialized();
  const { slug } = await params;
  const manager = new ArticleManager();
  const article = await manager.getArticleBySlug(slug);

  if (!article) return { title: 'Article Not Found | NAKSHATRA' };

  return {
    title: `${article.title} | NAKSHATRA`,
    description: article.metaDescription,
    openGraph: {
      title: article.title,
      description: article.metaDescription,
      type: 'article',
      publishedTime: article.publishedAt ? new Date(article.publishedAt).toISOString() : undefined,
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  await ensureDatabaseInitialized();
  const { slug } = await params;
  const manager = new ArticleManager();
  const article = await manager.getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  const confidencePercent = Math.round(parseFloat(article.confidenceScore) * 100);

  // Parse markdown body paragraphs
  const paragraphs = article.contentMarkdown.split('\n\n').filter((p) => p.trim().length > 0);

  // Schema.org JSON-LD structured data for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.metaDescription,
    datePublished: article.publishedAt ? new Date(article.publishedAt).toISOString() : new Date().toISOString(),
    author: {
      '@type': 'Organization',
      name: 'NAKSHATRA Autonomous Editorial Agent',
    },
    publisher: {
      '@type': 'Organization',
      name: 'NAKSHATRA',
      url: 'https://nakshatra.ai',
    },
  };

  // Prevent script tag breakout XSS in JSON-LD
  const sanitizedJsonLd = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return (
    <article className="space-y-8 max-w-4xl mx-auto pb-16">
      {/* JSON-LD Script */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: sanitizedJsonLd }}
      />

      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-sky-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Live Feed
        </Link>
      </div>

      {/* Article Header */}
      <header className="space-y-4 border-b border-slate-800 pb-6">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            {confidencePercent}% Evidence-Grounded
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            {article.readingTimeMinutes} min read
          </span>
          <span className="text-slate-500">
            Published {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : 'Recently'}
          </span>
        </div>

        <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          {article.title}
        </h1>

        <p className="text-base sm:text-xl text-slate-300 font-normal leading-relaxed">
          {article.deck}
        </p>
      </header>

      {/* Article Content with Interactive Footnote Citations */}
      <div className="prose prose-invert max-w-none text-slate-200 text-base sm:text-lg leading-relaxed space-y-6">
        {paragraphs.map((p, idx) => (
          <p key={idx} className="leading-relaxed">
            {renderParagraphWithCitations(p)}
          </p>
        ))}
      </div>

      {/* Ground Truth & Verified Citations Panel */}
      <section className="mt-12 rounded-2xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-sky-400" />
            <h2 className="text-lg font-bold text-white">Verified Ground Truth & Evidence Citations</h2>
          </div>
          <span className="text-xs text-slate-400">
            {article.citations.length} Verified Sources
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Every statement in this report is bound to primary documentation. Under NAKSHATRA’s verification invariant, no hallucinated or uncorroborated factual claims are permitted.
        </p>

        <div className="space-y-4">
          {article.citations.map((citation) => (
            <div
              key={citation.id}
              id={`citation-${citation.citationIndex}`}
              className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 scroll-mt-24 transition-colors hover:border-sky-500/40"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-mono text-xs flex items-center justify-center font-bold">
                    [{citation.citationIndex}]
                  </span>
                  <span className="font-semibold text-sm text-white">{citation.anchorText}</span>
                  <span className="text-xs text-slate-400 font-mono">({citation.sourcePublisher})</span>
                </div>
              </div>

              <a
                href={citation.primarySourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-semibold transition-colors self-start sm:self-auto"
              >
                Inspect Primary Source
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
