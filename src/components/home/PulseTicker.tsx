'use client';

import React from 'react';
import { Activity, ShieldCheck, Database, Radio } from 'lucide-react';
import { useLanguage } from '../../context/language-context';
import { toBengaliDigits } from '../../lib/i18n';

interface PulseTickerProps {
  storiesIngestedToday: number;
  activeSourcesCount: number;
  articlesPublishedCount: number;
}

export function PulseTicker({
  storiesIngestedToday,
  activeSourcesCount,
  articlesPublishedCount,
}: PulseTickerProps) {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  const displayIngested = isBn ? toBengaliDigits(storiesIngestedToday) : storiesIngestedToday;
  const displaySources = isBn ? toBengaliDigits(activeSourcesCount) : activeSourcesCount;
  const displayPublished = isBn ? toBengaliDigits(articlesPublishedCount) : articlesPublishedCount;

  return (
    <div
      className={`bg-[#ffffff] border border-[#d9d9d9] px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs ${
        isBn ? 'font-bengali' : ''
      }`}
      style={{ borderRadius: 0 }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex items-center gap-1.5 px-2.5 py-1 bg-[#f1ebfc] text-[#1e0a3c] font-mono font-bold text-[11px] border border-[#d9d9d9] uppercase tracking-wider"
          style={{ borderRadius: 0 }}
        >
          <span className="w-2 h-2 bg-[#d91b74] animate-pulse" />
          <Radio className="w-3.5 h-3.5 text-[#d91b74]" />
          {t.livePulse}
        </span>
        <span className="text-[#6e6e6e] font-mono text-[11px] hidden sm:inline uppercase">
          {t.pulseDaemon}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-[#120424]">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-[#1e0a3c]" />
          <span className="text-[#120424] font-bold font-mono">{displayIngested}</span>
          <span className="text-[#6e6e6e] text-[11px] uppercase">{t.storiesIngestedToday}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
          <span className="text-[#120424] font-bold font-mono">{displaySources}</span>
          <span className="text-[#6e6e6e] text-[11px] uppercase">{t.verifiedSourcesActive}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[#1e0a3c]" />
          <span className="text-[#120424] font-bold font-mono">{displayPublished}</span>
          <span className="text-[#6e6e6e] text-[11px] uppercase">{t.articlesSynthesized}</span>
        </div>
      </div>
    </div>
  );
}
