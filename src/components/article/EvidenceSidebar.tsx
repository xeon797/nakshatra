'use client';

import React, { useState } from 'react';
import { ExternalLink, ShieldCheck, ChevronDown, ChevronUp, Bookmark } from 'lucide-react';
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
        color: 'bg-[#1e0a3c] text-white border-[#1e0a3c]',
      };
    }
    if (tier.includes('2') || tier.includes('verified')) {
      return {
        label: isBn ? 'টায়ার ২ প্রাতিষ্ঠানিক' : 'Tier 2 Academic',
        color: 'bg-[#f1ebfc] text-[#7b3fe4] border-[#d9d9d9]',
      };
    }
    return {
      label: isBn ? 'টায়ার ৩ সাংবাদিকতা' : 'Tier 3 Journalism',
      color: 'bg-[#fdfbe4] text-[#120424] border-[#d9d9d9]',
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
      color: 'bg-[#1e0a3c] text-white border-[#1e0a3c]',
    };
  }
  if (lower.includes('arxiv') || lower.includes('paper') || lower.includes('mit')) {
    return {
      label: isBn ? 'টায়ার ২ প্রাতিষ্ঠানিক' : 'Tier 2 Academic',
      color: 'bg-[#f1ebfc] text-[#7b3fe4] border-[#d9d9d9]',
    };
  }
  return {
    label: isBn ? 'টায়ার ৩ সাংবাদিকতা' : 'Tier 3 Journalism',
    color: 'bg-[#fdfbe4] text-[#120424] border-[#d9d9d9]',
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
      className={`bg-[#ffffff] border border-[#d9d9d9] p-5 space-y-4 ${
        isBn ? 'font-bengali' : ''
      }`}
      style={{ borderRadius: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#d9d9d9] pb-3">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-[#1e0a3c]" />
          <h3 className="text-xs font-bold text-[#120424] uppercase tracking-wider font-display">
            {t.evidenceDrawerTitle}
          </h3>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-[#6e6e6e] hover:text-[#120424] p-1 transition-colors"
          title={isOpen ? 'Collapse drawer' : 'Expand drawer'}
        >
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Meta Score */}
      <div
        className="flex items-center justify-between text-xs bg-[#f1ebfc] p-2.5 border border-[#d9d9d9]"
        style={{ borderRadius: 0 }}
      >
        <span className="text-[#1e0a3c] flex items-center gap-1.5 font-bold font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
          {t.groundingInvariant}
        </span>
        <span className="text-[#1e0a3c] font-mono font-bold">
          {displayConfidence}% {t.corroborated}
        </span>
      </div>

      {/* Citation Cards */}
      {isOpen && (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1 scrollbar-thin">
          {citations.length === 0 ? (
            <p className="text-xs text-[#6e6e6e] py-3 text-center">
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
                  className="p-3 bg-[#fdfcf3] border border-[#d9d9d9] space-y-2.5 scroll-mt-24 transition-colors hover:border-[#120424]"
                  style={{ borderRadius: 0 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="w-5 h-5 bg-[#1e0a3c] text-white font-mono text-[11px] font-bold flex items-center justify-center shrink-0"
                      style={{ borderRadius: 0 }}
                    >
                      [{citIndex}]
                    </span>

                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 border ${tierBadge.color}`}
                      style={{ borderRadius: 0 }}
                    >
                      {tierBadge.label}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-serif italic text-[#120424] leading-snug line-clamp-2">
                      &ldquo;{c.anchorText}&rdquo;
                    </p>
                    <p className="text-[11px] font-mono text-[#6e6e6e]">
                      {isBn ? 'প্রকাশক:' : 'Publisher:'}{' '}
                      <span className="text-[#120424] font-semibold">{c.sourcePublisher}</span>
                    </p>
                  </div>

                  <a
                    href={c.primarySourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#d91b74] hover:underline font-display uppercase tracking-wider transition-colors"
                  >
                    <span>{t.viewPrimaryDoc}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              );
            })
          )}

          <div className="pt-2 text-[10px] text-[#6e6e6e] text-center leading-relaxed font-mono">
            <span className="text-[#d91b74] mr-1">✦</span>
            {t.ngramNotice}
          </div>
        </div>
      )}
    </aside>
  );
}
