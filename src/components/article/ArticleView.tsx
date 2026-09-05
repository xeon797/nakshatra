'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
import { BroadsheetImagePlaceholder } from '../brand/BroadsheetImagePlaceholder';

export interface ArticleViewData {
  id: string;
  title: string;
  slug: string;
  deck: string;
  contentMarkdown: string;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
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
            className="text-[#d91b74] hover:text-[#bf1363] font-mono text-xs font-bold px-1 py-0.5 bg-[#fdfcf3] border border-[#d9d9d9] mx-0.5 transition-colors"
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
        return { label: t.modelsCategory, color: 'bg-[#f1ebfc] text-[#1e0a3c] border-[#d9d9d9]' };
      case 'agentic':
        return { label: t.agentsCategory, color: 'bg-[#f1ebfc] text-[#1e0a3c] border-[#d9d9d9]' };
      case 'infra':
        return { label: t.infraCategory, color: 'bg-[#fdfbe4] text-[#120424] border-[#d9d9d9]' };
      case 'research':
        return { label: t.researchCategory, color: 'bg-[#f1ebfc] text-[#7b3fe4] border-[#d9d9d9]' };
      case 'policy':
        return { label: t.policyCategory, color: 'bg-[#fdfbe4] text-[#120424] border-[#d9d9d9]' };
      default:
        return { label: isBn ? 'এআই সংবাদ' : 'AI Intelligence', color: 'bg-[#ffffff] text-[#120424] border-[#d9d9d9]' };
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

  const articleImageUrl = article.imageUrl || article.heroImageUrl;

  return (
    <div className="max-w-[1240px] mx-auto pb-20 space-y-8">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className={`inline-flex items-center gap-2 text-xs font-bold text-[#6e6e6e] hover:text-[#120424] transition-colors uppercase tracking-wider font-display`}
        >
          <ArrowLeft className="w-4 h-4 text-[#1e0a3c]" />
          <span>{t.backToFeed}</span>
        </Link>
      </div>

      {/* Main Grid: Left is Article Content (8 cols), Right is Evidence Drawer (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Article Body & Header */}
        <article className="lg:col-span-8 space-y-8">
          {/* Story Header */}
          <header className="space-y-4 border-b border-[#d9d9d9] pb-6">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
              <span
                className={`px-2.5 py-0.5 border font-mono font-bold uppercase tracking-wider text-[11px] ${
                  isBn ? 'font-bengali' : ''
                } ${categoryBadge.color}`}
                style={{ borderRadius: 0 }}
              >
                {categoryBadge.label}
              </span>

              <span className="text-[#6e6e6e] text-[11px] flex items-center gap-1 font-mono">
                <Clock className="w-3.5 h-3.5 text-[#6e6e6e]" />
                <span className={isBn ? 'font-bengali' : ''}>{readingTimeStr}</span>
              </span>

              <span className="text-[#d9d9d9] text-[11px]">&bull;</span>

              <span className={`text-[#6e6e6e] text-[11px] ${isBn ? 'font-bengali' : 'font-mono'}`}>
                {formattedDate}
              </span>
            </div>

            <h1
              className={`text-3xl sm:text-4xl md:text-5xl font-black text-[#120424] tracking-tight ${
                isBn ? 'font-bengali leading-[1.3]' : 'font-display leading-tight'
              }`}
            >
              {title}
            </h1>

            <p
              className={`text-lg sm:text-xl text-[#6e6e6e] font-normal ${
                isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
              }`}
            >
              {deck}
            </p>

            {/* Author / Agent Signature */}
            <div className="pt-2 flex items-center gap-3">
              <div
                className="w-8 h-8 bg-[#f1ebfc] border border-[#d9d9d9] flex items-center justify-center text-[#1e0a3c]"
                style={{ borderRadius: 0 }}
              >
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className={`text-xs font-bold text-[#120424] flex items-center gap-1.5 ${isBn ? 'font-bengali' : 'font-display'}`}>
                  <span>{t.synthesizedBy}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
                </div>
                <div className={`text-[11px] text-[#6e6e6e] ${isBn ? 'font-bengali' : 'font-mono'}`}>
                  {t.autonomousVerification}
                </div>
              </div>
            </div>
          </header>

          {/* Lead Article Image / Broadsheet Placeholder */}
          <div
            className="relative w-full aspect-[16/9] border border-[#d9d9d9] overflow-hidden bg-[#fdfbe4]"
            style={{ borderRadius: 0 }}
          >
            {articleImageUrl ? (
              <Image
                src={articleImageUrl}
                alt={title}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <BroadsheetImagePlaceholder
                category={categoryBadge.label.toUpperCase()}
                headline={title}
                aspectRatio="16/9"
              />
            )}
          </div>

          {/* Automated Executive Summary / Key Takeaways Callout Box */}
          {keyTakeaways.length > 0 && (
            <section
              className="bg-[#fdfbe4] border border-[#d9d9d9] border-l-4 border-l-[#1e0a3c] p-6 space-y-3"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#1e0a3c]" />
                <h2 className={`text-xs font-bold text-[#1e0a3c] uppercase tracking-wider font-display ${isBn ? 'font-bengali' : ''}`}>
                  {t.executiveSummary}
                </h2>
              </div>
              <ul className="space-y-2 text-sm text-[#120424]">
                {keyTakeaways.map((takeaway, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 bg-[#d91b74] mt-2 shrink-0" />
                    <span className={isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'}>
                      {takeaway}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Article Main Text */}
          <div className="max-w-none text-[#120424] text-base sm:text-lg space-y-6">
            {paragraphs.map((p, idx) => (
              <p
                key={idx}
                className={isBn ? 'font-bengali leading-[1.85]' : 'leading-relaxed text-[#120424]'}
              >
                {renderParagraphWithCitations(p, isBn)}
              </p>
            ))}
          </div>

          {/* Multi-Perspective & Differing Viewpoints Section */}
          {secondarySources.length > 0 && (
            <section
              className="mt-8 bg-[#ffffff] border border-[#d9d9d9] p-6 space-y-4"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center gap-2 text-[#1e0a3c] border-b border-[#d9d9d9] pb-3">
                <GitBranch className="w-4 h-4" />
                <h3 className={`text-xs font-bold uppercase tracking-wider font-display text-[#120424] ${isBn ? 'font-bengali' : ''}`}>
                  {t.multiPerspectiveTitle}
                </h3>
              </div>
              <p className={`text-xs text-[#6e6e6e] ${isBn ? 'font-bengali leading-[1.7]' : 'leading-relaxed'}`}>
                {t.multiPerspectiveSubtitle}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {secondarySources.map((sec, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-[#fdfcf3] border border-[#d9d9d9] space-y-1.5"
                    style={{ borderRadius: 0 }}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#120424] font-mono">{sec.name}</span>
                      <span
                        className="text-[10px] px-2 py-0.5 bg-[#f1ebfc] text-[#1e0a3c] border border-[#d9d9d9] font-mono font-medium uppercase"
                        style={{ borderRadius: 0 }}
                      >
                        {sec.tier?.replace(/_/g, ' ') || 'Journalism'}
                      </span>
                    </div>
                    <p className="text-xs text-[#6e6e6e] line-clamp-2">{sec.title}</p>
                    <a
                      href={sec.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 text-[11px] font-bold text-[#d91b74] hover:underline font-display uppercase tracking-wider ${
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
          <div className="pt-6 border-t border-[#d9d9d9] flex items-center justify-between text-xs text-[#6e6e6e]">
            <span className={`flex items-center gap-1.5 ${isBn ? 'font-bengali' : 'font-mono'}`}>
              <ShieldCheck className="w-4 h-4 text-[#1e0a3c]" />
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
