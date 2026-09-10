'use client';

import React from 'react';
import { useLanguage } from '../../context/language-context';

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="inline-flex items-center bg-white border border-[#d9d9d9] p-0.5" style={{ borderRadius: 0 }}>
      {/* English Button */}
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-2.5 py-1 text-xs font-display font-bold transition-colors ${
          language === 'en'
            ? 'bg-[#1e0a3c] text-white'
            : 'bg-white text-[#120424] hover:bg-[#fdfbe4]'
        }`}
        style={{ borderRadius: 0 }}
        aria-label="Switch to English"
      >
        EN
      </button>

      {/* Divider */}
      <span className="text-[#d9d9d9] text-xs px-1 select-none">|</span>

      {/* Bengali Button */}
      <button
        type="button"
        onClick={() => setLanguage('bn')}
        className={`px-2.5 py-1 text-xs font-bengali font-bold transition-colors ${
          language === 'bn'
            ? 'bg-[#1e0a3c] text-white'
            : 'bg-white text-[#120424] hover:bg-[#fdfbe4]'
        }`}
        style={{ borderRadius: 0 }}
        aria-label="বাংলা ভাষায় পরিবর্তন করুন"
      >
        বাংলা
      </button>
    </div>
  );
}
