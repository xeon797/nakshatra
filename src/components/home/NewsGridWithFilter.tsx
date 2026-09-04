'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, ShieldCheck, Clock, ArrowRight, Layers, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../../context/language-context';
import { toBengaliDigits, formatReadingTime } from '../../lib/i18n';

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
        return { label: t.modelsCategory, color: 'bg-sky-500/10 text-sky-400 border-sky-500/20' };
      case 'agentic':
        return { label: t.agentsCategory, color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
      case 'infra':
        return { label: t.infraCategory, color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
      case 'research':
        return { label: t.researchCategory, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'policy':
        return { label: t.policyCategory, color: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
      default:
        return { label: isBn ? 'এআই সংবাদ' : 'AI Intelligence', color: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
  };

  const getRiskBadge = (riskLevel?: string) => {
    switch (riskLevel) {
      case 'high':
        return {
          label: t.highRisk,
          icon: ShieldAlert,
          color: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        };
      case 'medium':
        return {
          label: t.mediumRisk,
          icon: AlertTriangle,
          color: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        };
      case 'low':
      default:
        return {
          label: t.lowRisk,
          icon: ShieldCheck,
          color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
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
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        {/* Topic Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {topicTabs.map((tab) => {
            const isActive = selectedTopic === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSelectedTopic(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isBn ? 'font-bengali' : ''
                } ${
                  isActive
                    ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800/80 border border-slate-800'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px] sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className={`w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 transition-colors ${
              isBn ? 'font-bengali' : ''
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span className={isBn ? 'font-bengali' : ''}>
          {t.showingCount}{' '}
          <strong className="text-white font-mono">
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
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center space-y-3 bg-slate-950/40">
          <Layers className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className={`text-base font-semibold text-white ${isBn ? 'font-bengali' : ''}`}>
            {t.noStoriesMatch}
          </h3>
          <button
            onClick={() => {
              setSelectedTopic('all');
              setSearchQuery('');
            }}
            className={`mt-2 text-xs text-sky-400 hover:underline font-semibold ${
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
                className="card-hover flex flex-col justify-between rounded-xl bg-slate-900/70 border border-slate-800/90 p-5 shadow-sm transition-all hover:border-slate-700"
              >
                <div className="space-y-3">
                  {/* Top Meta Badges */}
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={`px-2.5 py-0.5 rounded-full border font-semibold tracking-wide uppercase ${
                        isBn ? 'font-bengali' : ''
                      } ${categoryBadge.color}`}
                    >
                      {categoryBadge.label}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${
                        isBn ? 'font-bengali' : ''
                      } ${riskBadge.color}`}
                    >
                      <RiskIcon className="w-3 h-3" />
                      {riskBadge.label}
                    </span>
                  </div>

                  {/* Title */}
                  <h3
                    className={`text-base font-bold text-white hover:text-sky-400 transition-colors ${
                      isBn ? 'font-bengali leading-[1.45]' : 'leading-snug'
                    }`}
                  >
                    <Link href={`/article/${article.slug}`}>{displayTitle}</Link>
                  </h3>

                  {/* Excerpt */}
                  <p
                    className={`text-slate-400 text-xs line-clamp-3 ${
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
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/60"
                        >
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Meta */}
                <div className="pt-4 mt-4 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-3 text-slate-400">
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span className={isBn ? 'font-bengali' : ''}>{readingTimeStr}</span>
                    </span>
                    <span className="text-emerald-400 font-medium font-mono">
                      {displayConfidence}% {isBn ? 'যাচাইকৃত' : 'Grounded'}
                    </span>
                  </div>

                  <Link
                    href={`/article/${article.slug}`}
                    className={`inline-flex items-center gap-1 font-semibold text-sky-400 hover:text-sky-300 text-xs ${
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
