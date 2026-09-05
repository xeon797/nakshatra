'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShieldCheck, Clock, ArrowRight, Zap, Layers } from 'lucide-react';
import { ArticleCardItem } from './NewsGridWithFilter';
import { useLanguage } from '../../context/language-context';
import { formatTimeAgo, toBengaliDigits } from '../../lib/i18n';
import { BroadsheetImagePlaceholder } from '../brand/BroadsheetImagePlaceholder';

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
    <section
      className="bg-[#ffffff] border border-[#d9d9d9] p-6 sm:p-8"
      style={{ borderRadius: 0 }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
        {/* Left/Main Column: Story Content */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            {/* Top Badges */}
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#d91b74] text-white font-display font-bold tracking-wider uppercase text-[11px]"
                style={{ borderRadius: 0 }}
              >
                <Zap className="w-3 h-3" />
                {t.topStoryBreaking}
              </span>

              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#f1ebfc] text-[#1e0a3c] border border-[#d9d9d9] font-mono text-[11px] font-medium"
                style={{ borderRadius: 0 }}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
                {displayConfidence}% {t.evidenceGrounded}
              </span>

              <span className="text-[#6e6e6e] font-mono text-[11px] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {timeAgo}
              </span>
            </div>

            {/* Headline */}
            <h2
              className={`text-2xl sm:text-3xl lg:text-4xl font-black text-[#120424] tracking-tight hover:text-[#d91b74] transition-colors ${
                isBn ? 'font-bengali leading-[1.35]' : 'font-display leading-tight'
              }`}
            >
              <Link href={`/article/${story.slug}`}>{title}</Link>
            </h2>

            {/* 2-Sentence Executive Summary */}
            <p
              className={`text-[#6e6e6e] text-sm sm:text-base ${
                isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
              }`}
            >
              {summary}
            </p>
          </div>

          {/* Multi-Source Pills & CTA */}
          <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-[#d9d9d9]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-[#1e0a3c] flex items-center gap-1 uppercase tracking-wider font-display">
                <Layers className="w-3.5 h-3.5 text-[#1e0a3c]" />
                {t.verifiedSources}:
              </span>
              {story.sources.map((s, idx) => (
                <span
                  key={idx}
                  className="text-[11px] font-mono px-2 py-0.5 bg-[#fdfcf3] text-[#1e0a3c] border border-[#d9d9d9] font-medium"
                  style={{ borderRadius: 0 }}
                >
                  {s.name}
                </span>
              ))}
            </div>

            <Link
              href={`/article/${story.slug}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e0a3c] hover:bg-[#120424] text-white font-bold text-xs uppercase tracking-wider font-display transition-colors self-start sm:self-auto"
              style={{ borderRadius: 0 }}
            >
              <span>{t.readAndVerify}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Right Column: Hero Thumbnail or Broadsheet Placeholder */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div
            className="relative w-full aspect-[16/9] sm:aspect-[3/2] border border-[#d9d9d9] overflow-hidden bg-[#fdfbe4]"
            style={{ borderRadius: 0 }}
          >
            {story.imageUrl ? (
              <Image
                src={story.imageUrl}
                alt={title}
                fill
                unoptimized
                className="object-cover transition-transform duration-300 hover:scale-105"
              />
            ) : (
              <BroadsheetImagePlaceholder
                category={story.category.toUpperCase()}
                headline={title}
                aspectRatio="3/2"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
