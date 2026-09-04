'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, ShieldCheck, Clock, ArrowRight, Layers, AlertTriangle, ShieldAlert } from 'lucide-react';

export interface ArticleCardItem {
  id: string;
  title: string;
  slug: string;
  deck: string;
  category: string;
  riskLevel?: string;
  confidenceScore: string;
  readingTimeMinutes: number;
  publishedAt: Date | string | null;
  sources: Array<{ name: string; tier?: string; isPrimary?: boolean }>;
}

const TOPIC_TABS = [
  { id: 'all', label: 'All Stories' },
  { id: 'llm_release', label: 'Models & LLMs' },
  { id: 'agentic', label: 'Autonomous Agents' },
  { id: 'infra', label: 'AI Infrastructure' },
  { id: 'research', label: 'Research Papers' },
  { id: 'policy', label: 'Policy & Safety' },
];

function getCategoryBadge(category: string) {
  switch (category) {
    case 'llm_release':
      return { label: 'Models & LLMs', color: 'bg-sky-500/10 text-sky-400 border-sky-500/20' };
    case 'agentic':
      return { label: 'Autonomous Agents', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
    case 'infra':
      return { label: 'Infrastructure', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    case 'research':
      return { label: 'Research Papers', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    case 'policy':
      return { label: 'Policy & Safety', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
    default:
      return { label: 'AI Intelligence', color: 'bg-slate-800 text-slate-300 border-slate-700' };
  }
}

function getRiskBadge(riskLevel?: string) {
  switch (riskLevel) {
    case 'high':
      return {
        label: 'High Risk Triage',
        icon: ShieldAlert,
        color: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      };
    case 'medium':
      return {
        label: 'Medium Risk',
        icon: AlertTriangle,
        color: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      };
    case 'low':
    default:
      return {
        label: 'Low Risk',
        icon: ShieldCheck,
        color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
  }
}

interface NewsGridWithFilterProps {
  articles: ArticleCardItem[];
}

export function NewsGridWithFilter({ articles }: NewsGridWithFilterProps) {
  const [selectedTopic, setSelectedTopic] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      // Category match
      const matchesCategory = selectedTopic === 'all' || article.category === selectedTopic;

      // Search match
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        query === '' ||
        article.title.toLowerCase().includes(query) ||
        article.deck.toLowerCase().includes(query) ||
        article.sources.some((s) => s.name.toLowerCase().includes(query));

      return matchesCategory && matchesSearch;
    });
  }, [articles, selectedTopic, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Controls Bar: Topic Tabs + Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        {/* Topic Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {TOPIC_TABS.map((tab) => {
            const isActive = selectedTopic === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSelectedTopic(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
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
            placeholder="Search news, labs, models..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 transition-colors"
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
        <span>
          Showing <strong className="text-white">{filteredArticles.length}</strong>{' '}
          {selectedTopic === 'all' ? 'total' : ''} verified stories
        </span>
        {searchQuery && (
          <span>
            Filtered by: &ldquo;{searchQuery}&rdquo;
          </span>
        )}
      </div>

      {/* Grid */}
      {filteredArticles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center space-y-3 bg-slate-950/40">
          <Layers className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-white">No stories match your criteria</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Try adjusting your search terms or selecting a different topic tab.
          </p>
          <button
            onClick={() => {
              setSelectedTopic('all');
              setSearchQuery('');
            }}
            className="mt-2 text-xs text-sky-400 hover:underline font-semibold"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArticles.map((article) => {
            const categoryBadge = getCategoryBadge(article.category);
            const riskBadge = getRiskBadge(article.riskLevel);
            const RiskIcon = riskBadge.icon;
            const confidencePercent = Math.round(parseFloat(article.confidenceScore) * 100);

            return (
              <article
                key={article.id}
                className="card-hover flex flex-col justify-between rounded-xl bg-slate-900/70 border border-slate-800/90 p-5 shadow-sm transition-all hover:border-slate-700"
              >
                <div className="space-y-3">
                  {/* Top Meta Badges */}
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={`px-2.5 py-0.5 rounded-full border font-semibold tracking-wide uppercase ${categoryBadge.color}`}
                    >
                      {categoryBadge.label}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${riskBadge.color}`}
                    >
                      <RiskIcon className="w-3 h-3" />
                      {riskBadge.label}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-bold text-white hover:text-sky-400 transition-colors leading-snug">
                    <Link href={`/article/${article.slug}`}>{article.title}</Link>
                  </h3>

                  {/* Excerpt */}
                  <p className="text-slate-400 text-xs line-clamp-3 leading-relaxed">
                    {article.deck}
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
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {article.readingTimeMinutes} min
                    </span>
                    <span className="text-emerald-400 font-medium">
                      {confidencePercent}% Grounded
                    </span>
                  </div>

                  <Link
                    href={`/article/${article.slug}`}
                    className="inline-flex items-center gap-1 font-semibold text-sky-400 hover:text-sky-300 text-xs"
                  >
                    Verify
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
