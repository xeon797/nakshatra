'use client';

import React from 'react';
import Link from 'next/link';
import { Mail, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/language-context';
import { toBengaliDigits } from '../../lib/i18n';

export function HomeFeedHeader() {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  const today = new Date();
  const enDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const bnDate = `${toBengaliDigits(today.getDate())} ${
    [
      'জানুয়ারি',
      'ফেব্রুয়ারি',
      'মার্চ',
      'এপ্রিল',
      'মে',
      'জুন',
      'জুলাই',
      'আগস্ট',
      'সেপ্টেম্বর',
      'অক্টোবর',
      'নভেম্বর',
      'ডিসেম্বর',
    ][today.getMonth()]
  }, ${toBengaliDigits(today.getFullYear())}`;

  return (
    <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-y border-[#d9d9d9] py-4 my-2">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 bg-[#d91b74] animate-pulse" />
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#120424] font-display">
            {isBn ? 'নক্ষত্র নিউজডেস্ক' : 'NAKSHATRA DISPATCH'}
          </h1>
          <span
            className="text-[11px] px-2 py-0.5 bg-[#1e0a3c] text-white font-mono font-bold tracking-wider uppercase"
            style={{ borderRadius: 0 }}
          >
            {isBn ? 'গোয়েন্দা পর্যবেক্ষণ' : 'INTELLIGENCE DESK'}
          </span>
        </div>
        <p className={`text-xs text-[#6e6e6e] ${isBn ? 'font-bengali' : 'font-mono'}`}>
          {isBn ? bnDate : enDate} &bull; {t.subtitle}
        </p>
      </div>

      <div className="flex items-center gap-2.5">
        <a
          href="#newsletter-subscribe"
          className={`inline-flex items-center gap-2 px-3.5 py-2 bg-[#d91b74] hover:bg-[#bf1363] text-white font-bold text-xs font-display tracking-wider uppercase transition-colors ${
            isBn ? 'font-bengali' : ''
          }`}
          style={{ borderRadius: 0 }}
        >
          <Mail className="w-3.5 h-3.5" />
          <span>{t.getDigest}</span>
        </a>
        <Link
          href="/admin/newsroom"
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#ffffff] hover:bg-[#fdfbe4] text-[#120424] border border-[#d9d9d9] text-xs font-bold font-display uppercase tracking-wider transition-colors ${
            isBn ? 'font-bengali' : ''
          }`}
          style={{ borderRadius: 0 }}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
          <span>{t.navNewsroom}</span>
        </Link>
      </div>
    </section>
  );
}

export function FeedSectionHeading() {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  return (
    <div className="border-b border-[#d9d9d9] pb-3">
      <h2
        className={`text-xl sm:text-2xl font-black text-[#120424] tracking-tight flex flex-wrap items-center gap-2.5 ${
          isBn ? 'font-bengali' : 'font-display'
        }`}
      >
        <span>{t.verifiedFeed}</span>
        <span className="text-xs font-normal text-[#6e6e6e] font-mono">
          ({t.filteredByLabs})
        </span>
      </h2>
    </div>
  );
}
