'use client';

import React, { useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useLanguage } from '../../context/language-context';

export function NewsletterCapture() {
  const { language, t } = useLanguage();
  const isBn = language === 'bn';

  const topicOptions = [
    { id: 'models', label: t.modelsCategory },
    { id: 'agents', label: t.agentsCategory },
    { id: 'infra', label: t.infraCategory },
    { id: 'research', label: t.researchCategory },
    { id: 'policy', label: t.policyCategory },
  ];

  const [email, setEmail] = useState('');
  const [selectedTopics, setSelectedTopics] = useState<string[]>(['models', 'agents', 'research']);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const toggleTopic = (topicId: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topicId) ? prev.filter((t) => t !== topicId) : [...prev, topicId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setStatus('error');
      setMessage(isBn ? 'অনুগ্রহ করে সঠিক ইমেইল ঠিকানা প্রদান করুন।' : 'Please enter a valid email address.');
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          topics: selectedTopics.length > 0 ? selectedTopics : ['all'],
          preferredLanguage: language,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus('success');
        setMessage(data.message || t.subscribeSuccessMsg);
        setEmail('');
      } else {
        setStatus('error');
        setMessage(data.error || (isBn ? 'সাবস্ক্রিপশন ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।' : 'Failed to subscribe. Please try again.'));
      }
    } catch {
      setStatus('error');
      setMessage(isBn ? 'নেটওয়ার্ক ত্রুটি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।' : 'Network error. Please check your connection and try again.');
    }
  };

  return (
    <section
      id="newsletter-subscribe"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 p-8 sm:p-12 shadow-2xl scroll-mt-24"
    >
      <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-semibold tracking-wider uppercase">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isBn ? 'শূন্য-বিভ্রান্তি গোয়েন্দা ব্রিফিং' : 'Zero-Hallucination Intelligence Briefing'}</span>
        </div>

        <h2
          className={`text-2xl sm:text-4xl font-extrabold text-white tracking-tight ${
            isBn ? 'font-bengali leading-[1.3]' : 'font-display leading-tight'
          }`}
        >
          {t.subscribeTitle}
        </h2>

        <p
          className={`text-slate-300 text-sm sm:text-base ${
            isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
          }`}
        >
          {t.subscribeSubtitle}
        </p>

        {status === 'success' ? (
          <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-8 h-8" />
            <h3 className={`font-bold text-lg text-white ${isBn ? 'font-bengali' : ''}`}>
              {t.subscribeSuccess}
            </h3>
            <p className={`text-sm text-slate-300 ${isBn ? 'font-bengali' : ''}`}>{message}</p>
            <button
              onClick={() => setStatus('idle')}
              className={`mt-3 text-xs text-sky-400 hover:underline font-medium ${isBn ? 'font-bengali' : ''}`}
            >
              {isBn ? 'অন্য ইমেইল সাবস্ক্রাইব করুন →' : 'Subscribe another email \u2192'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-left">
            {/* Topic Preferences */}
            <div>
              <label className={`block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 ${isBn ? 'font-bengali' : ''}`}>
                {t.customizeTopics}
              </label>
              <div className="flex flex-wrap gap-2">
                {topicOptions.map((opt) => {
                  const isChecked = selectedTopics.includes(opt.id);
                  return (
                    <button
                      type="button"
                      key={opt.id}
                      onClick={() => toggleTopic(opt.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all font-medium flex items-center gap-1.5 ${
                        isBn ? 'font-bengali' : ''
                      } ${
                        isChecked
                          ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold shadow-sm'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isChecked ? 'bg-sky-400' : 'bg-slate-600'
                        }`}
                      />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Email Form */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  required
                  className={`w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 transition-colors ${
                    isBn ? 'font-bengali' : ''
                  }`}
                />
              </div>

              <button
                type="submit"
                disabled={status === 'loading'}
                className={`px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 whitespace-nowrap ${
                  isBn ? 'font-bengali' : ''
                }`}
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.subscribing}</span>
                  </>
                ) : (
                  <span>{t.subscribeButton}</span>
                )}
              </button>
            </div>

            {status === 'error' && (
              <div className="flex items-center gap-2 text-rose-400 text-xs mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className={isBn ? 'font-bengali' : ''}>{message}</span>
              </div>
            )}

            <p className={`text-center text-[11px] text-slate-500 pt-1 ${isBn ? 'font-bengali' : ''}`}>
              {isBn
                ? '১২,০০০+ এআই গবেষক ও প্রকৌশলীর সাথে যুক্ত হোন। যেকোনো সময় ১-ক্লিকে আনসাবস্ক্রাইব করতে পারবেন।'
                : 'Join 12,000+ AI researchers and engineers. Unsubscribe anytime with 1-click.'}
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
