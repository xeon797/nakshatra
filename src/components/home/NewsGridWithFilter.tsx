'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Search, ShieldCheck, Clock, ArrowRight, Layers, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../../context/language-context';
import { toBengaliDigits, formatReadingTime } from '../../lib/i18n';
import { BroadsheetImagePlaceholder } from '../brand/BroadsheetImagePlaceholder';

export interface ArticleCardItem {
  id: string;
  title: string;
  titleEn?: string;
  titleBn?: string;
  slug: string;
  deck: string;
  summaryEn?: string;
  summaryBn?: string;
  category: string;
  riskLevel?: string;
  confidenceScore: string;
  readingTimeMinutes: number;
  publishedAt: Date | string | null;
  sources: Array<{ name: string; tier?: string; isPrimary?: boolean }>;
  imageUrl?: string | null;
}

export function NewsGridWithFilter({ articles }: NewsGridWithFilterProps) {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  const [selectedTopic, setSelectedTopic] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const topicTabs = [
    { id: 'all', label: t.allStories },
    { id: 'llm_release', label: t.modelsCategory },
    { id: 'agentic', label: t.agentsCategory },
    { id: 'infra', label: t.infraCategory },
    { id: 'research', label: t.researchCategory },
    { id: 'policy', label: t.policyCategory },
  ];

  const getCategoryBadge = (category: string) => {
    switch (category) {
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

  const getRiskBadge = (riskLevel?: string) => {
    switch (riskLevel) {
      case 'high':
        return {
          label: t.highRisk,
          icon: ShieldAlert,
          color: 'bg-[#ffffff] text-[#d91b74] border-[#d91b74]',
        };
      case 'medium':
        return {
          label: t.mediumRisk,
          icon: AlertTriangle,
          color: 'bg-[#fdfbe4] text-[#120424] border-[#d9d9d9]',
        };
      case 'low':
      default:
        return {
          label: t.lowRisk,
          icon: ShieldCheck,
          color: 'bg-[#f1ebfc] text-[#1e0a3c] border-[#d9d9d9]',
        };
    }
  };

  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      // Category match
      const matchesCategory = selectedTopic === 'all' || article.category === selectedTopic;

      // Search match (checks title, titleEn, titleBn, deck, summaryEn, summaryBn, sources)
      const query = searchQuery.trim().toLowerCase();
      if (!matchesCategory) return false;
      if (query === '') return true;

      const searchableText = [
        article.title,
        article.titleEn || '',
        article.titleBn || '',
        article.deck,
        article.summaryEn || '',
        article.summaryBn || '',
        ...article.sources.map((s) => s.name),
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [articles, selectedTopic, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Controls Bar: Topic Tabs + Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-[#d9d9d9] pb-4">
        {/* Topic Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {topicTabs.map((tab) => {
            const isActive = selectedTopic === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSelectedTopic(tab.id)}
                className={`px-3 py-1.5 text-xs font-bold font-display uppercase tracking-wider whitespace-nowrap transition-colors border ${
                  isBn ? 'font-bengali' : ''
                } ${
                  isActive
                    ? 'bg-[#1e0a3c] text-white border-[#1e0a3c]'
                    : 'bg-[#ffffff] text-[#120424] hover:bg-[#fdfbe4] border-[#d9d9d9]'
                }`}
                style={{ borderRadius: 0 }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px] sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e6e6e]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className={`w-full pl-9 pr-3 py-1.5 bg-[#ffffff] border border-[#d9d9d9] text-[#120424] placeholder-[#6e6e6e] text-xs focus:outline-none focus:border-[#120424] transition-colors ${
              isBn ? 'font-bengali' : ''
            }`}
            style={{ borderRadius: 0 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6e6e6e] hover:text-[#120424]"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-[#6e6e6e] px-1">
        <span className={isBn ? 'font-bengali' : ''}>
          {t.showingCount}{' '}
          <strong className="text-[#120424] font-mono">
            {isBn ? toBengaliDigits(filteredArticles.length) : filteredArticles.length}
          </strong>{' '}
          {t.totalVerifiedStories}
        </span>
        {searchQuery && (
          <span className={isBn ? 'font-bengali' : ''}>
            {isBn ? 'অনুসন্ধান:' : 'Filtered by:'} &ldquo;{searchQuery}&rdquo;
          </span>
        )}
      </div>

      {/* Grid */}
      {filteredArticles.length === 0 ? (
        <div
          className="border border-dashed border-[#d9d9d9] bg-[#ffffff] p-12 text-center space-y-3"
          style={{ borderRadius: 0 }}
        >
          <Layers className="w-8 h-8 text-[#6e6e6e] mx-auto" />
          <h3 className={`text-base font-bold font-display text-[#120424] ${isBn ? 'font-bengali' : ''}`}>
            {t.noStoriesMatch}
          </h3>
          <button
            onClick={() => {
              setSelectedTopic('all');
              setSearchQuery('');
            }}
            className={`mt-2 text-xs text-[#d91b74] hover:underline font-bold uppercase tracking-wider font-display ${
              isBn ? 'font-bengali' : ''
            }`}
          >
            {t.resetFilters}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArticles.map((article) => {
            const categoryBadge = getCategoryBadge(article.category);
            const riskBadge = getRiskBadge(article.riskLevel);
            const RiskIcon = riskBadge.icon;
            const confidencePercent = Math.round(parseFloat(article.confidenceScore) * 100);

            const displayTitle =
              isBn && article.titleBn ? article.titleBn : (article.titleEn || article.title);
            const displayDeck =
              isBn && article.summaryBn ? article.summaryBn : (article.summaryEn || article.deck);
            const displayConfidence = isBn ? toBengaliDigits(confidencePercent) : confidencePercent;
            const readingTimeStr = formatReadingTime(article.readingTimeMinutes, language);

            return (
              <article
                key={article.id}
                className="card-hover flex flex-col justify-between bg-[#ffffff] border border-[#d9d9d9] p-4 transition-colors"
                style={{ borderRadius: 0 }}
              >
                <div className="space-y-3">
                  {/* Article Thumbnail Image / Broadsheet Fallback */}
                  <div
                    className="relative w-full aspect-[16/9] border border-[#d9d9d9] overflow-hidden bg-[#fdfbe4]"
                    style={{ borderRadius: 0 }}
                  >
                    {article.imageUrl ? (
                      <Image
                        src={article.imageUrl}
                        alt={displayTitle}
                        fill
                        unoptimized
                        className="object-cover transition-transform duration-300 hover:scale-105"
                      />
                    ) : (
                      <BroadsheetImagePlaceholder
                        category={article.category.toUpperCase()}
                        headline={displayTitle}
                        aspectRatio="16/9"
                      />
                    )}
                  </div>

                  {/* Top Meta Badges */}
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={`px-2 py-0.5 border font-mono font-bold tracking-wide uppercase ${
                        isBn ? 'font-bengali' : ''
                      } ${categoryBadge.color}`}
                      style={{ borderRadius: 0 }}
                    >
                      {categoryBadge.label}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-mono font-medium uppercase ${
                        isBn ? 'font-bengali' : ''
                      } ${riskBadge.color}`}
                      style={{ borderRadius: 0 }}
                    >
                      <RiskIcon className="w-3 h-3" />
                      {riskBadge.label}
                    </span>
                  </div>

                  {/* Title */}
                  <h3
                    className={`text-base font-bold text-[#120424] hover:text-[#d91b74] transition-colors ${
                      isBn ? 'font-bengali leading-[1.45]' : 'font-display leading-snug'
                    }`}
                  >
                    <Link href={`/article/${article.slug}`}>{displayTitle}</Link>
                  </h3>

                  {/* Excerpt */}
                  <p
                    className={`text-[#6e6e6e] text-xs line-clamp-3 ${
                      isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
                    }`}
                  >
                    {displayDeck}
                  </p>

                  {/* Multi-Source Pills */}
                  {article.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {article.sources.map((s, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] font-mono px-2 py-0.5 bg-[#fdfcf3] text-[#1e0a3c] border border-[#d9d9d9]"
                          style={{ borderRadius: 0 }}
                        >
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Meta */}
                <div className="pt-3 mt-4 border-t border-[#d9d9d9] flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-3 text-[#6e6e6e]">
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3 text-[#6e6e6e]" />
                      <span className={isBn ? 'font-bengali' : ''}>{readingTimeStr}</span>
                    </span>
                    <span className="text-[#1e0a3c] font-bold font-mono">
                      {displayConfidence}% {isBn ? 'যাচাইকৃত' : 'Grounded'}
                    </span>
                  </div>

                  <Link
                    href={`/article/${article.slug}`}
                    className={`inline-flex items-center gap-1 font-bold text-xs font-display uppercase tracking-wider text-[#1e0a3c] hover:text-[#d91b74] transition-colors ${
                      isBn ? 'font-bengali' : ''
                    }`}
                  >
                    <span>{isBn ? 'যাচাই করুন' : 'Verify'}</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface NewsGridWithFilterProps {
  articles: ArticleCardItem[];
}
