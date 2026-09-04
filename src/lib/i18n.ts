export type Language = 'en' | 'bn';

export const BENGALI_NUMERALS: Record<string, string> = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
};

export function toBengaliDigits(input: number | string): string {
  return String(input).replace(/[0-9]/g, (digit) => BENGALI_NUMERALS[digit] || digit);
}

export function formatTimeAgo(dateInput: Date | string | null, lang: Language): string {
  if (!dateInput) return lang === 'bn' ? 'সম্প্রতি' : 'Recently';
  const date = new Date(dateInput);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return lang === 'bn' ? 'এইমাত্র' : 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return lang === 'bn' ? `${toBengaliDigits(minutes)} মিনিট আগে` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return lang === 'bn' ? `${toBengaliDigits(hours)} ঘণ্টা আগে` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return lang === 'bn' ? `${toBengaliDigits(days)} দিন আগে` : `${days}d ago`;
}

export function formatReadingTime(minutes: number, lang: Language): string {
  if (lang === 'bn') {
    return `${toBengaliDigits(minutes)} মিনিট পাঠ`;
  }
  return `${minutes} min read`;
}

export const I18N_DICTIONARY = {
  en: {
    siteName: 'NAKSHATRA',
    tagline: 'Autonomous AI Intelligence',
    subtitle: 'Zero-Hallucination, 100% Evidence-Grounded Autonomous Journalism',
    navFeed: 'Live Feed',
    navNewsroom: 'Newsroom Desk',
    navObservability: 'Observability',
    getDigest: 'Get Daily Digest',
    livePulse: 'LIVE PULSE',
    pulseDaemon: 'Autonomous Newsroom Daemon Operational',
    storiesIngestedToday: 'stories ingested today',
    verifiedSourcesActive: 'verified sources active',
    articlesSynthesized: 'articles synthesized',
    topStoryBreaking: 'Top Story • Breaking',
    evidenceGrounded: 'Evidence-Grounded',
    verifiedSources: 'Verified Sources',
    readAndVerify: 'Read & Verify Evidence',
    verifiedFeed: 'Verified Intelligence Feed',
    filteredByLabs: 'Filtered by primary lab releases & verified research',
    searchPlaceholder: 'Search news, labs, models...',
    showingCount: 'Showing',
    totalVerifiedStories: 'verified stories',
    noStoriesMatch: 'No stories match your criteria',
    resetFilters: 'Reset Filters',
    allStories: 'All Stories',
    modelsCategory: 'Models & LLMs',
    agentsCategory: 'Autonomous Agents',
    infraCategory: 'AI Infrastructure',
    researchCategory: 'Research Papers',
    policyCategory: 'Policy & Safety',
    lowRisk: 'Low Risk',
    mediumRisk: 'Medium Risk',
    highRisk: 'High Risk Triage',
    subscribeTitle: 'Stay Ahead of Frontier AI Breakthroughs',
    subscribeSubtitle:
      'Receive a daily executive digest synthesized autonomously from verified technical reports and primary lab documentation. No speculative noise, zero verbatim copy.',
    customizeTopics: 'Customize Topic Preferences',
    emailPlaceholder: 'Enter your work email (e.g. researcher@openai.com)',
    subscribeButton: 'Subscribe Free',
    subscribing: 'Subscribing...',
    subscribeSuccess: 'Subscription Confirmed',
    subscribeSuccessMsg: 'You have successfully subscribed to NAKSHATRA Daily.',
    executiveSummary: 'Executive Summary • Key Takeaways',
    synthesizedBy: 'Synthesized by NAKSHATRA Editorial Agent',
    autonomousVerification: 'Autonomous Multi-Source Fact Verification & Evidence Grounding',
    multiPerspectiveTitle: 'Multi-Perspective & Industry Analysis',
    multiPerspectiveSubtitle:
      'In addition to official primary lab releases, NAKSHATRA aggregated independent reporting and analysis to provide a balanced industry context:',
    readExternalReport: 'Read external report',
    evidenceDrawerTitle: 'Verified Evidence Drawer',
    groundingInvariant: 'Grounding Invariant',
    corroborated: 'Corroborated',
    viewPrimaryDoc: 'View Primary Documentation',
    ngramNotice: 'Every statement checked against N-gram verbatim overlap limits < 12%.',
    backToFeed: 'Back to Live Feed',
    footerNotice: '© 2026 NAKSHATRA. Autonomous, evidence-grounded AI journalism. Primary source attributions guaranteed.',
    languageSelect: 'Language',
  },
  bn: {
    siteName: 'নক্ষত্র',
    tagline: 'স্বায়ত্তশাসিত এআই ইন্টেলিজেন্স',
    subtitle: 'শূন্য-বিভ্রান্তি, শতভাগ তথ্যপ্রমাণ ভিত্তিক স্বায়ত্তশাসিত সাংবাদিকতা',
    navFeed: 'লাইভ ফিড',
    navNewsroom: 'নিউজ রুম',
    navObservability: 'অবজার্ভেবিলিটি',
    getDigest: 'দৈনিক ডাইজেস্ট পান',
    livePulse: 'লাইভ পালস',
    pulseDaemon: 'স্বায়ত্তশাসিত এআই নিউজ ডেমোন সক্রিয় রয়েছে',
    storiesIngestedToday: 'টি খবর আজ সংগৃহীত',
    verifiedSourcesActive: 'টি নির্ভরযোগ্য উৎস সক্রিয়',
    articlesSynthesized: 'টি প্রতিবেদন প্রকাশিত',
    topStoryBreaking: 'প্রধান খবর • ব্রেকিং',
    evidenceGrounded: 'তথ্যপ্রমাণ ভিত্তিক',
    verifiedSources: 'যাচাইকৃত উৎসসমূহ',
    readAndVerify: 'উৎস ও প্রমাণ যাচাই করুন',
    verifiedFeed: 'যাচাইকৃত এআই সংবাদ ফিড',
    filteredByLabs: 'শীর্ষ ল্যাব প্রকাশনা ও গবেষণাপত্রের সরাসরি বিশ্লেষণ',
    searchPlaceholder: 'সংবাদ, ল্যাব ও মডেল অনুসন্ধান করুন...',
    showingCount: 'প্রদর্শিত হচ্ছে',
    totalVerifiedStories: 'টি যাচাইকৃত প্রতিবেদন',
    noStoriesMatch: 'আপনার অনুসন্ধানের সাথে কোনো খবর মেলেনি',
    resetFilters: 'ফিল্টার রিসেট করুন',
    allStories: 'সকল সংবাদ',
    modelsCategory: 'মডেল ও এলএলএম',
    agentsCategory: 'স্বায়ত্তশাসিত এজেন্ট',
    infraCategory: 'এআই ইনফ্রাস্ট্রাকচার',
    researchCategory: 'গবেষণাপত্র',
    policyCategory: 'নীতিমালা ও নিরাপত্তা',
    lowRisk: 'স্বল্প ঝুঁকি',
    mediumRisk: 'মাঝারি ঝুঁকি',
    highRisk: 'উচ্চ ঝুঁকি ট্রায়াজ',
    subscribeTitle: 'ফ্রন্টিয়ার এআই-এর সবচেয়ে গুরুত্বপূর্ণ খবরে এগিয়ে থাকুন',
    subscribeSubtitle:
      'প্রতিদিন পান যাচাইকৃত প্রযুক্তিগত রিপোর্ট ও প্রাথমিক ল্যাব নথির নির্যাস। কোনো অনুমান বা গুজবের স্থান নেই, শতভাগ তথ্যভিত্তিক।',
    customizeTopics: 'পছন্দের বিষয় নির্বাচন করুন',
    emailPlaceholder: 'আপনার ইমেইল লিখুন (যেমন: researcher@lab.ai)',
    subscribeButton: 'বিনামূল্যে সাবস্ক্রাইব করুন',
    subscribing: 'সংযুক্ত হচ্ছে...',
    subscribeSuccess: 'সাবস্ক্রিপশন সম্পন্ন হয়েছে',
    subscribeSuccessMsg: 'আপনি সফলভাবে নক্ষত্র দৈনিক ব্রিফিংয়ে যুক্ত হয়েছেন।',
    executiveSummary: 'নির্বাহী সারসংক্ষেপ • মূল দিকসমূহ',
    synthesizedBy: 'নক্ষত্র এডিটোরিয়াল এজেন্ট দ্বারা সংশ্লেষিত',
    autonomousVerification: 'স্বায়ত্তশাসিত বহু-উৎস তথ্য যাচাই ও এভিডেন্স গ্রাউন্ডিং',
    multiPerspectiveTitle: 'বহু-দৃষ্টিকোণ ও শিল্প বিশ্লেষণ',
    multiPerspectiveSubtitle:
      'প্রাথমিক ল্যাব রিলিজের পাশাপাশি, ভারসাম্যপূর্ণ বিশ্লেষণের জন্য স্বাধীন সাংবাদিকতা ও পর্যবেক্ষণ অন্তর্ভুক্ত করা হয়েছে:',
    readExternalReport: 'বাইরের প্রতিবেদন পড়ুন',
    evidenceDrawerTitle: 'যাচাইকৃত তথ্যপ্রমাণ ড্রয়ার',
    groundingInvariant: 'গ্রাউন্ডিং নিশ্চিতকরণ',
    corroborated: 'যাচাইকৃত',
    viewPrimaryDoc: 'মূল নথিপত্র দেখুন',
    ngramNotice: 'প্রতিটি বাক্য এন-গ্রাম আক্ষরিক অনুলিপি সীমা ১২% এর নিচে পরীক্ষা করা হয়েছে।',
    backToFeed: 'মূল ফিডে ফিরে যান',
    footerNotice: '© ২০২৬ নক্ষত্র (NAKSHATRA)। স্বায়ত্তশাসিত তথ্যপ্রমাণ-ভিত্তিক সাংবাদিকতা। মূল উৎসের স্বীকৃতি নিশ্চিত।',
    languageSelect: 'ভাষা',
  },
};

export type Dictionary = {
  [K in keyof typeof I18N_DICTIONARY.bn]: string;
};

export function getTranslation(lang: Language): Dictionary {
  return I18N_DICTIONARY[lang] || I18N_DICTIONARY.bn;
}
