import React from 'react';
import { Activity, ShieldCheck, Database, Radio } from 'lucide-react';

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
  return (
    <div className="rounded-xl bg-slate-900/80 border border-slate-800/80 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 font-mono font-medium border border-emerald-500/20">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <Radio className="w-3.5 h-3.5" />
          LIVE PULSE
        </span>
        <span className="text-slate-400 hidden sm:inline">
          Autonomous Newsroom Daemon Operational
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-slate-300 font-mono">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-white font-bold">{storiesIngestedToday}</span>
          <span className="text-slate-400 text-[11px]">stories ingested today</span>
        </div>

        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-white font-bold">{activeSourcesCount}</span>
          <span className="text-slate-400 text-[11px]">verified sources active</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-white font-bold">{articlesPublishedCount}</span>
          <span className="text-slate-400 text-[11px]">articles synthesized</span>
        </div>
      </div>
    </div>
  );
}
