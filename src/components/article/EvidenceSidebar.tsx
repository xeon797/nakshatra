'use client';

import React, { useState } from 'react';
import { ExternalLink, ShieldCheck, ChevronDown, ChevronUp, Bookmark, Sparkles } from 'lucide-react';
import { useLanguage } from '../../context/language-context';
import { toBengaliDigits } from '../../lib/i18n';

export interface CitationItem {
  id: string;
  citationIndex: number;
  anchorText: string;
  primarySourceUrl: string;
  sourcePublisher: string;
  sourceTier?: string;
}

interface EvidenceSidebarProps {
  citations: CitationItem[];
  confidenceScore: string;
}

function resolveTierBadge(publisher: string, tier?: string, isBn?: boolean) {
  if (tier) {
    if (tier.includes('1') || tier.includes('primary')) {
      return {
        label: isBn ? 'টায়ার ১ প্রাথমিক' : 'Tier 1 Primary',
        color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
    }
    if (tier.includes('2') || tier.includes('verified')) {
      return {
        label: isBn ? 'টায়ার ২ প্রাতিষ্ঠানিক' : 'Tier 2 Academic',
        color: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      };
    }
    return {
      label: isBn ? 'টায়ার ৩ সাংবাদিকতা' : 'Tier 3 Journalism',
      color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    };
  }

  const lower = publisher.toLowerCase();
  if (
    lower.includes('openai') ||
    lower.includes('anthropic') ||
    lower.includes('deepmind') ||
    lower.includes('google') ||
    lower.includes('meta') ||
    lower.includes('mistral') ||
    lower.includes('microsoft')
  ) {
    return {
      label: isBn ? 'টায়ার ১ ল্যাব' : 'Tier 1 Primary Lab',
      color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
  }
  if (lower.includes('arxiv') || lower.includes('paper') || lower.includes('mit')) {
    return {
      label: isBn ? 'টায়ার ২ প্রাতিষ্ঠানিক' : 'Tier 2 Academic',
      color: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    };
  }
  return {
    label: isBn ? 'টায়ার ৩ সাংবাদিকতা' : 'Tier 3 Journalism',
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
}

export function EvidenceSidebar({ citations, confidenceScore }: EvidenceSidebarProps) {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  const [isOpen, setIsOpen] = useState(true);
  const confidencePercent = Math.round(parseFloat(confidenceScore) * 100);
  const displayConfidence = isBn ? toBengaliDigits(confidencePercent) : confidencePercent;

  return (
    <aside
      className={`rounded-2xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl space-y-4 ${
        isBn ? 'font-bengali' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            {t.evidenceDrawerTitle}
          </h3>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          title={isOpen ? 'Collapse drawer' : 'Expand drawer'}
        >
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Meta Score */}
      <div className="flex items-center justify-between text-xs bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <span className="text-slate-400 flex items-center gap-1.5 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          {t.groundingInvariant}
        </span>
        <span className="text-emerald-400 font-mono font-bold">
          {displayConfidence}% {t.corroborated}
        </span>
      </div>

      {/* Citation Cards */}
      {isOpen && (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
          {citations.length === 0 ? (
            <p className="text-xs text-slate-500 py-3 text-center">
              {isBn ? 'এই প্রতিবেদনের সাথে কোনো তথ্যপ্রমাণ সংযুক্ত নেই।' : 'No citations bound to this draft.'}
            </p>
          ) : (
            citations.map((c) => {
              const tierBadge = resolveTierBadge(c.sourcePublisher, c.sourceTier, isBn);
              const citIndex = isBn ? toBengaliDigits(c.citationIndex) : c.citationIndex;

              return (
                <div
                  key={c.id}
                  id={`citation-${c.citationIndex}`}
                  className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-2.5 scroll-mt-24 transition-all hover:border-sky-500/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="w-5 h-5 rounded-md bg-sky-500/20 text-sky-400 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                      [{citIndex}]
                    </span>

                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${tierBadge.color}`}
                    >
                      {tierBadge.label}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-200 leading-snug line-clamp-2">
                      &ldquo;{c.anchorText}&rdquo;
                    </p>
                    <p className="text-[11px] font-mono text-slate-400">
                      {isBn ? 'প্রকাশক:' : 'Publisher:'}{' '}
                      <span className="text-slate-300 font-semibold">{c.sourcePublisher}</span>
                    </p>
                  </div>

                  <a
                    href={c.primarySourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                  >
                    <span>{t.viewPrimaryDoc}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              );
            })
          )}

          <div className="pt-2 text-[10px] text-slate-500 text-center leading-relaxed">
            <Sparkles className="w-3 h-3 inline mr-1 text-sky-400" />
            {t.ngramNotice}
          </div>
        </div>
      )}
    </aside>
  );
}
