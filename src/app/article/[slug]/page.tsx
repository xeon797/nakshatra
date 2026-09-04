import React from 'react';
import { notFound } from 'next/navigation';
import { ArticleManager } from '../../../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../../../db/init';
import Link from 'next/link';
import {
  ShieldCheck,
  Clock,
  ArrowLeft,
  Bot,
  CheckCircle2,
  GitBranch,
  ExternalLink,
  Layers,
} from 'lucide-react';
import type { Metadata } from 'next';
import { EvidenceSidebar, CitationItem } from '../../../components/article/EvidenceSidebar';

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
            className="text-sky-400 hover:text-sky-300 font-mono text-xs font-bold px-1 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 mx-0.5 transition-colors"
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

function getCategoryBadge(category: string) {
  switch (category) {
    case 'llm_release':
      return { label: 'Models & LLMs', color: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
    case 'agentic':
      return { label: 'Autonomous Agents', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' };
    case 'infra':
      return { label: 'AI Infrastructure', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
    case 'research':
      return { label: 'Research Papers', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
    case 'policy':
      return { label: 'Policy & Safety', color: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
    default:
      return { label: 'AI Intelligence', color: 'bg-slate-800 text-slate-300 border-slate-700' };
  }
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

  // Calculate dynamic reading time estimate from actual word count
  const wordCount = article.contentMarkdown.split(/\s+/).filter(Boolean).length;
  const computedReadingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Determine category
  const categoryKey = article.story?.category || 'llm_release';
  const categoryBadge = getCategoryBadge(categoryKey);

  // Parse markdown body paragraphs
  const paragraphs = article.contentMarkdown.split('\n\n').filter((p) => p.trim().length > 0);

  // Generate automated Executive Summary / Key Takeaways
  const keyTakeaways: string[] = [];
  if (article.deck) {
    const sentences = article.deck.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 10);
    keyTakeaways.push(...sentences);
  }
  if (keyTakeaways.length === 0 && paragraphs[0]) {
    keyTakeaways.push(paragraphs[0].slice(0, 150) + '...');
  }

  // Extract differing perspectives from secondary sources
  const secondarySources = (article.storySources || []).filter((s) => !s.isPrimary);

  // Citations list for sidebar
  const sidebarCitations: CitationItem[] = (article.citations || []).map((c) => ({
    id: c.id,
    citationIndex: c.citationIndex,
    anchorText: c.anchorText,
    primarySourceUrl: c.primarySourceUrl,
    sourcePublisher: c.sourcePublisher,
    sourceTier: article.storySources?.find((s) => s.name === c.sourcePublisher)?.tier,
  }));

  // Schema.org JSON-LD structured data for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.metaDescription,
    datePublished: article.publishedAt
      ? new Date(article.publishedAt).toISOString()
      : new Date().toISOString(),
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

  const sanitizedJsonLd = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  const formattedDate = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Recently Published';

  return (
    <div className="max-w-7xl mx-auto pb-20 space-y-8">
      {/* JSON-LD Script */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: sanitizedJsonLd }}
      />

      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-sky-400 transition-colors uppercase tracking-wider font-mono"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Live Feed
        </Link>
      </div>

      {/* Main Grid: Left is Article Content (8 cols), Right is Evidence Drawer (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Article Body & Header */}
        <article className="lg:col-span-8 space-y-8">
          {/* Story Header */}
          <header className="space-y-4 border-b border-slate-800 pb-8">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
              <span
                className={`px-3 py-1 rounded-full border font-bold uppercase tracking-wider text-[11px] ${categoryBadge.color}`}
              >
                {categoryBadge.label}
              </span>

              <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {computedReadingTime} min read
              </span>

              <span className="text-slate-500 text-[11px]">&bull;</span>

              <span className="text-slate-400 font-mono text-[11px]">
                {formattedDate}
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
              {article.title}
            </h1>

            <p className="text-lg sm:text-xl text-slate-300 font-normal leading-relaxed">
              {article.deck}
            </p>

            {/* Author / Agent Signature */}
            <div className="pt-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>Synthesized by NAKSHATRA Editorial Agent</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Autonomous Multi-Source Fact Verification &amp; Evidence Grounding
                </div>
              </div>
            </div>
          </header>

          {/* Automated Executive Summary / Key Takeaways Callout Box */}
          <section className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/20 border-l-4 border-l-sky-500 border-y border-r border-slate-800 p-6 space-y-3 shadow-md">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Executive Summary &bull; Key Takeaways
              </h2>
            </div>
            <ul className="space-y-2 text-sm text-slate-300">
              {keyTakeaways.map((takeaway, i) => (
                <li key={i} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 shrink-0" />
                  <span>{takeaway}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Article Main Text */}
          <div className="prose prose-invert max-w-none text-slate-200 text-base sm:text-lg leading-relaxed space-y-6">
            {paragraphs.map((p, idx) => (
              <p key={idx} className="leading-relaxed">
                {renderParagraphWithCitations(p)}
              </p>
            ))}
          </div>

          {/* Multi-Perspective & Differing Viewpoints Section */}
          {secondarySources.length > 0 && (
            <section className="mt-8 rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-4">
              <div className="flex items-center gap-2 text-purple-400 border-b border-slate-800 pb-3">
                <GitBranch className="w-4 h-4" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                  Multi-Perspective &amp; Industry Analysis
                </h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                In addition to official primary lab releases, NAKSHATRA aggregated independent reporting and analysis to provide a balanced industry context:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {secondarySources.map((sec, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-300 font-mono">{sec.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium uppercase">
                        {sec.tier?.replace(/_/g, ' ') || 'Journalism'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">{sec.title}</p>
                    <a
                      href={sec.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                    >
                      <span>Read external report</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Invariant Attestation Footer */}
          <div className="pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Verified without LLM hallucination
            </span>
            <span>NAKSHATRA Autonomous Pipeline</span>
          </div>
        </article>

        {/* Right Column: Sticky Collapsible Evidence Drawer */}
        <div className="lg:col-span-4 lg:sticky lg:top-24 space-y-6">
          <EvidenceSidebar
            citations={sidebarCitations}
            confidenceScore={article.confidenceScore}
          />
        </div>
      </div>
    </div>
  );
}
