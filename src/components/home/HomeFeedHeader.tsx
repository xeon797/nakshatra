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
    <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6 pt-2">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-mono">
            {isBn ? 'নক্ষত্র' : 'NAKSHATRA'}
          </h1>
          <span className="text-xs px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-semibold tracking-wider uppercase">
            {isBn ? 'ইন্টেলিজেন্স ব্রিফিং' : 'Intelligence Briefing'}
          </span>
        </div>
        <p className={`text-xs text-slate-400 ${isBn ? 'font-bengali' : 'font-mono'}`}>
          {isBn ? bnDate : enDate} &bull; {t.subtitle}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <a
          href="#newsletter-subscribe"
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 font-semibold text-xs transition-colors shadow-sm ${
            isBn ? 'font-bengali' : ''
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          <span>{t.getDigest}</span>
        </a>
        <Link
          href="/admin/newsroom"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-medium transition-colors ${
            isBn ? 'font-bengali' : ''
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
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
    <div className="border-b border-slate-800 pb-3">
      <h2
        className={`text-xl font-extrabold text-white tracking-tight flex flex-wrap items-center gap-2 ${
          isBn ? 'font-bengali' : 'font-display'
        }`}
      >
        <span>{t.verifiedFeed}</span>
        <span className="text-xs font-normal text-slate-400">
          ({t.filteredByLabs})
        </span>
      </h2>
    </div>
  );
}
