'use client';

import React from 'react';
import { useLanguage } from '../../context/language-context';
import { Globe } from 'lucide-react';

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="inline-flex items-center rounded-xl bg-slate-900 border border-slate-800 p-1 shadow-inner">
      <Globe className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-1 hidden sm:inline" />

      {/* English Button */}
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-2.5 py-1 rounded-lg text-xs font-display font-bold transition-all ${
          language === 'en'
            ? 'bg-sky-500 text-slate-950 shadow-sm'
            : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
        }`}
        aria-label="Switch to English"
      >
        EN
      </button>

      {/* Divider */}
      <span className="text-slate-700 text-xs px-0.5">|</span>

      {/* Bengali Button */}
      <button
        type="button"
        onClick={() => setLanguage('bn')}
        className={`px-2.5 py-1 rounded-lg text-xs font-bengali font-bold transition-all ${
          language === 'bn'
            ? 'bg-sky-500 text-slate-950 shadow-sm'
            : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
        }`}
        aria-label="বাংলা ভাষায় পরিবর্তন করুন"
      >
        বাংলা
      </button>
    </div>
  );
}
