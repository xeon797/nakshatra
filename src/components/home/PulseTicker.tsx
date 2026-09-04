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
      className={`rounded-xl bg-slate-900/80 border border-slate-800/80 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs ${
        isBn ? 'font-bengali' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 font-mono font-medium border border-emerald-500/20">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <Radio className="w-3.5 h-3.5" />
          {t.livePulse}
        </span>
        <span className="text-slate-400 hidden sm:inline">
          {t.pulseDaemon}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-slate-300">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-white font-bold font-mono">{displayIngested}</span>
          <span className="text-slate-400 text-[11px]">{t.storiesIngestedToday}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-white font-bold font-mono">{displaySources}</span>
          <span className="text-slate-400 text-[11px]">{t.verifiedSourcesActive}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-white font-bold font-mono">{displayPublished}</span>
          <span className="text-slate-400 text-[11px]">{t.articlesSynthesized}</span>
        </div>
      </div>
    </div>
  );
}
