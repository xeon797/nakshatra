'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Language, getTranslation, Dictionary } from '../lib/i18n';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: Dictionary;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('bn');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // 1. Read stored preference from localStorage
    try {
      const stored = localStorage.getItem('nakshatra_language') as Language | null;
      if (stored === 'en' || stored === 'bn') {
        setLanguageState(stored);
        document.documentElement.lang = stored;
        return;
      }

      // 2. Read cookie NEXT_LOCALE
      const cookieMatch = document.cookie.match(/NEXT_LOCALE=(en|bn)/);
      if (cookieMatch && (cookieMatch[1] === 'en' || cookieMatch[1] === 'bn')) {
        const cookieLang = cookieMatch[1] as Language;
        setLanguageState(cookieLang);
        document.documentElement.lang = cookieLang;
        return;
      }
    } catch {
      // Ignore if localStorage unavailable
    }

    // Default to Bengali
    document.documentElement.lang = 'bn';
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem('nakshatra_language', lang);
      document.cookie = `NEXT_LOCALE=${lang}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = lang;
      if (lang === 'bn') {
        document.documentElement.classList.add('lang-bn');
        document.documentElement.classList.remove('lang-en');
      } else {
        document.documentElement.classList.add('lang-en');
        document.documentElement.classList.remove('lang-bn');
      }
    } catch {
      // Ignore
    }
  };

  const toggleLanguage = () => {
    setLanguage(language === 'bn' ? 'en' : 'bn');
  };

  const t = getTranslation(language);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    // Default fallback if rendered outside provider
    return {
      language: 'bn' as Language,
      setLanguage: () => {},
      toggleLanguage: () => {},
      t: getTranslation('bn'),
    };
  }
  return context;
}
