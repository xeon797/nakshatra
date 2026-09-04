import React from 'react';
import Link from 'next/link';
import { ShieldCheck, Clock, ArrowRight, Zap, Layers } from 'lucide-react';
import { ArticleCardItem } from './NewsGridWithFilter';

interface HeroStoryProps {
  story: ArticleCardItem;
}

function formatTimeAgo(dateInput: Date | string | null): string {
  if (!dateInput) return 'Recently';
  const date = new Date(dateInput);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function HeroStory({ story }: HeroStoryProps) {
  const confidencePercent = Math.round(parseFloat(story.confidenceScore) * 100);
  const timeAgo = formatTimeAgo(story.publishedAt);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-indigo-950/40 border border-slate-800 p-6 sm:p-10 shadow-2xl">
      <div className="absolute top-0 right-0 -mt-10 -mr-10 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative space-y-5">
        {/* Top Badges */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold tracking-wider uppercase">
            <Zap className="w-3.5 h-3.5" />
            Top Story &bull; Breaking
          </span>

          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            {confidencePercent}% Evidence-Grounded
          </span>

          <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {timeAgo}
          </span>
        </div>

        {/* Headline */}
        <h2 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight hover:text-sky-400 transition-colors">
          <Link href={`/article/${story.slug}`}>{story.title}</Link>
        </h2>

        {/* 2-Sentence Executive Summary */}
        <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-4xl">
          {story.deck}
        </p>

        {/* Multi-Source Pills & CTA */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-800/80">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              Verified Sources:
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
            Read & Verify Evidence
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
