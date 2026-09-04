'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck, Clock, ArrowRight, Zap, Layers } from 'lucide-react';
import { ArticleCardItem } from './NewsGridWithFilter';
import { useLanguage } from '../../context/language-context';
import { formatTimeAgo, toBengaliDigits } from '../../lib/i18n';

interface HeroStoryProps {
  story: ArticleCardItem;
}

export function HeroStory({ story }: HeroStoryProps) {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  const confidencePercent = Math.round(parseFloat(story.confidenceScore) * 100);
  const displayConfidence = isBn ? toBengaliDigits(confidencePercent) : confidencePercent;
  const timeAgo = formatTimeAgo(story.publishedAt, language);

  const title = isBn && story.titleBn ? story.titleBn : (story.titleEn || story.title);
  const summary = isBn && story.summaryBn ? story.summaryBn : (story.summaryEn || story.deck);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-indigo-950/40 border border-slate-800 p-6 sm:p-10 shadow-2xl">
      <div className="absolute top-0 right-0 -mt-10 -mr-10 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative space-y-5">
        {/* Top Badges */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold tracking-wider uppercase">
            <Zap className="w-3.5 h-3.5" />
            {t.topStoryBreaking}
          </span>

          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            {displayConfidence}% {t.evidenceGrounded}
          </span>

          <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {timeAgo}
          </span>
        </div>

        {/* Headline */}
        <h2
          className={`text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight hover:text-sky-400 transition-colors ${
            isBn ? 'font-bengali leading-[1.35]' : 'font-display leading-tight'
          }`}
        >
          <Link href={`/article/${story.slug}`}>{title}</Link>
        </h2>

        {/* 2-Sentence Executive Summary */}
        <p
          className={`text-slate-300 text-base sm:text-lg max-w-4xl ${
            isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
          }`}
        >
          {summary}
        </p>

        {/* Multi-Source Pills & CTA */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-800/80">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              {t.verifiedSources}:
            </span>
            {story.sources.map((s, idx) => (
              <span
                key={idx}
                className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-800 text-sky-300 border border-slate-700/80 font-medium"
              >
                {s.name}
              </span>
            ))}
          </div>

          <Link
            href={`/article/${story.slug}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 text-slate-950 font-bold text-sm hover:bg-sky-400 transition-all shadow-lg shadow-sky-500/25 self-start sm:self-auto"
          >
            <span>{t.readAndVerify}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
