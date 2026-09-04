'use client';

import React from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Clock,
  ArrowLeft,
  Bot,
  CheckCircle2,
  GitBranch,
  ExternalLink,
} from 'lucide-react';
import { useLanguage } from '../../context/language-context';
import { toBengaliDigits, formatReadingTime } from '../../lib/i18n';
import { EvidenceSidebar, CitationItem } from './EvidenceSidebar';

export interface ArticleViewData {
  id: string;
  title: string;
  slug: string;
  deck: string;
  contentMarkdown: string;
  titleEn?: string | null;
  titleBn?: string | null;
  summaryEn?: string | null;
  summaryBn?: string | null;
  contentEn?: string | null;
  contentBn?: string | null;
  keyTakeawaysEn?: string[] | null;
  keyTakeawaysBn?: string[] | null;
  metaDescription: string;
  confidenceScore: string;
  readingTimeMinutes: number;
  publishedAt: Date | string | null;
  story?: {
    category?: string | null;
  } | null;
  storySources?: Array<{
    name: string;
    baseUrl: string;
    tier: string;
    isPrimary: boolean;
    title: string;
    url: string;
  }> | null;
  citations: Array<{
    id: string;
    citationIndex: number;
    anchorText: string;
    primarySourceUrl: string;
    sourcePublisher: string;
  }>;
}

interface ArticleViewProps {
  article: ArticleViewData;
}

function renderParagraphWithCitations(paragraph: string, isBn: boolean) {
  const parts = paragraph.split(/(\[\^?\d+\])/g);
  return parts.map((part, index) => {
    const match = part.match(/\[\^?(\d+)\]/);
    if (match) {
      const citNum = match[1];
      const displayNum = isBn ? toBengaliDigits(citNum) : citNum;
      return (
        <sup key={index} id={`ref-${citNum}`} className="scroll-mt-24">
          <a
            href={`#citation-${citNum}`}
            className="text-sky-400 hover:text-sky-300 font-mono text-xs font-bold px-1 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 mx-0.5 transition-colors"
            title={isBn ? `যাচাইকৃত সূত্র [${displayNum}] দেখুন` : `Jump to verified source citation [${citNum}]`}
          >
            [{displayNum}]
          </a>
        </sup>
      );
    }
    return part;
  });
}

export function ArticleView({ article }: ArticleViewProps) {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  // Active language fields with English/legacy fallbacks
  const title = isBn && article.titleBn ? article.titleBn : (article.titleEn || article.title);
  const deck = isBn && article.summaryBn ? article.summaryBn : (article.summaryEn || article.deck);
  const contentMarkdown =
    isBn && article.contentBn ? article.contentBn : (article.contentEn || article.contentMarkdown);

  // Key takeaways resolution
  let keyTakeaways: string[] = [];
  if (isBn && article.keyTakeawaysBn && article.keyTakeawaysBn.length > 0) {
    keyTakeaways = article.keyTakeawaysBn;
  } else if (!isBn && article.keyTakeawaysEn && article.keyTakeawaysEn.length > 0) {
    keyTakeaways = article.keyTakeawaysEn;
  } else if (deck) {
    keyTakeaways = deck.split(/(?<=[.?!।])\s+/).filter((s) => s.trim().length > 10);
  }

  // Reading time
  const wordCount = contentMarkdown.split(/\s+/).filter(Boolean).length;
  const computedMinutes = Math.max(1, Math.ceil(wordCount / (isBn ? 150 : 200)));
  const readingTimeStr = formatReadingTime(computedMinutes, language);

  // Date formatting
  let formattedDate = isBn ? 'সম্প্রতি প্রকাশিত' : 'Recently Published';
  if (article.publishedAt) {
    const pubDate = new Date(article.publishedAt);
    if (isBn) {
      const bnMonths = [
        'জানুয়ারি',
        'ফেব্রুয়ারি',
        'মার্চ',
        'এপ্রিল',
        'মে',
        'জুন',
        'জুলাই',
        'আগস্ট',
        'সেপ্টেম্বর',
        'অক্টোবর',
        'নভেম্বর',
        'ডিসেম্বর',
      ];
      formattedDate = `${toBengaliDigits(pubDate.getDate())} ${bnMonths[pubDate.getMonth()]}, ${toBengaliDigits(pubDate.getFullYear())}`;
    } else {
      formattedDate = pubDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }

  // Category
  const categoryKey = article.story?.category || 'llm_release';
  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'llm_release':
        return { label: t.modelsCategory, color: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
      case 'agentic':
        return { label: t.agentsCategory, color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' };
      case 'infra':
        return { label: t.infraCategory, color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      case 'research':
        return { label: t.researchCategory, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'policy':
        return { label: t.policyCategory, color: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
      default:
        return { label: isBn ? 'এআই সংবাদ' : 'AI Intelligence', color: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
  };
  const categoryBadge = getCategoryLabel(categoryKey);

  // Paragraphs
  const paragraphs = contentMarkdown.split('\n\n').filter((p) => p.trim().length > 0);

  // Secondary sources
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

  return (
    <div className="max-w-7xl mx-auto pb-20 space-y-8">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className={`inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-sky-400 transition-colors uppercase tracking-wider ${
            isBn ? 'font-bengali' : 'font-mono'
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t.backToFeed}</span>
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
                className={`px-3 py-1 rounded-full border font-bold uppercase tracking-wider text-[11px] ${
                  isBn ? 'font-bengali' : ''
                } ${categoryBadge.color}`}
              >
                {categoryBadge.label}
              </span>

              <span className="text-slate-400 text-[11px] flex items-center gap-1 font-mono">
                <Clock className="w-3.5 h-3.5" />
                <span className={isBn ? 'font-bengali' : ''}>{readingTimeStr}</span>
              </span>

              <span className="text-slate-500 text-[11px]">&bull;</span>

              <span className={`text-slate-400 text-[11px] ${isBn ? 'font-bengali' : 'font-mono'}`}>
                {formattedDate}
              </span>
            </div>

            <h1
              className={`text-3xl sm:text-5xl font-black text-white tracking-tight ${
                isBn ? 'font-bengali leading-[1.3]' : 'font-display leading-tight'
              }`}
            >
              {title}
            </h1>

            <p
              className={`text-lg sm:text-xl text-slate-300 font-normal ${
                isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
              }`}
            >
              {deck}
            </p>

            {/* Author / Agent Signature */}
            <div className="pt-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className={`text-xs font-bold text-white flex items-center gap-1.5 ${isBn ? 'font-bengali' : ''}`}>
                  <span>{t.synthesizedBy}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className={`text-[11px] text-slate-400 ${isBn ? 'font-bengali' : 'font-mono'}`}>
                  {t.autonomousVerification}
                </div>
              </div>
            </div>
          </header>

          {/* Automated Executive Summary / Key Takeaways Callout Box */}
          {keyTakeaways.length > 0 && (
            <section className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/20 border-l-4 border-l-sky-500 border-y border-r border-slate-800 p-6 space-y-3 shadow-md">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-400" />
                <h2 className={`text-sm font-bold text-white uppercase tracking-wider ${isBn ? 'font-bengali' : ''}`}>
                  {t.executiveSummary}
                </h2>
              </div>
              <ul className="space-y-2 text-sm text-slate-300">
                {keyTakeaways.map((takeaway, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 shrink-0" />
                    <span className={isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'}>
                      {takeaway}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Article Main Text */}
          <div className="prose prose-invert max-w-none text-slate-200 text-base sm:text-lg space-y-6">
            {paragraphs.map((p, idx) => (
              <p
                key={idx}
                className={isBn ? 'font-bengali leading-[1.85]' : 'leading-relaxed'}
              >
                {renderParagraphWithCitations(p, isBn)}
              </p>
            ))}
          </div>

          {/* Multi-Perspective & Differing Viewpoints Section */}
          {secondarySources.length > 0 && (
            <section className="mt-8 rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-4">
              <div className="flex items-center gap-2 text-purple-400 border-b border-slate-800 pb-3">
                <GitBranch className="w-4 h-4" />
                <h3 className={`text-sm font-bold uppercase tracking-wider text-white ${isBn ? 'font-bengali' : ''}`}>
                  {t.multiPerspectiveTitle}
                </h3>
              </div>
              <p className={`text-xs text-slate-400 ${isBn ? 'font-bengali leading-[1.7]' : 'leading-relaxed'}`}>
                {t.multiPerspectiveSubtitle}
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
                      className={`inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium ${
                        isBn ? 'font-bengali' : ''
                      }`}
                    >
                      <span>{t.readExternalReport}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Invariant Attestation Footer */}
          <div className="pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
            <span className={`flex items-center gap-1.5 ${isBn ? 'font-bengali' : 'font-mono'}`}>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              {isBn ? 'এলএলএম বিভ্রান্তি ছাড়া তথ্য যাচাইকৃত' : 'Verified without LLM hallucination'}
            </span>
            <span className={isBn ? 'font-bengali' : 'font-mono'}>
              {isBn ? 'নক্ষত্র স্বায়ত্তশাসিত পাইপলাইন' : 'NAKSHATRA Autonomous Pipeline'}
            </span>
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
