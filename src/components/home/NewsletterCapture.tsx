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
      className="bg-[#ffffff] border border-[#d9d9d9] p-8 sm:p-12 scroll-mt-24"
      style={{ borderRadius: 0 }}
    >
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 bg-[#f1ebfc] border border-[#d9d9d9] text-[#1e0a3c] text-xs font-mono font-bold tracking-wider uppercase"
          style={{ borderRadius: 0 }}
        >
          <Sparkles className="w-3.5 h-3.5 text-[#d91b74]" />
          <span>{isBn ? 'শূন্য-বিভ্রান্তি গোয়েন্দা ব্রিফিং' : 'Zero-Hallucination Intelligence Briefing'}</span>
        </div>

        <h2
          className={`text-2xl sm:text-4xl font-black text-[#120424] tracking-tight ${
            isBn ? 'font-bengali leading-[1.3]' : 'font-display leading-tight'
          }`}
        >
          {t.subscribeTitle}
        </h2>

        <p
          className={`text-[#6e6e6e] text-sm sm:text-base ${
            isBn ? 'font-bengali leading-[1.75]' : 'leading-relaxed'
          }`}
        >
          {t.subscribeSubtitle}
        </p>

        {status === 'success' ? (
          <div
            className="p-6 bg-[#fdfbe4] border border-[#d9d9d9] flex flex-col items-center gap-2 text-[#1e0a3c]"
            style={{ borderRadius: 0 }}
          >
            <CheckCircle2 className="w-8 h-8 text-[#1e0a3c]" />
            <h3 className={`font-bold text-lg text-[#120424] ${isBn ? 'font-bengali' : 'font-display'}`}>
              {t.subscribeSuccess}
            </h3>
            <p className={`text-sm text-[#6e6e6e] ${isBn ? 'font-bengali' : ''}`}>{message}</p>
            <button
              onClick={() => setStatus('idle')}
              className={`mt-3 text-xs text-[#d91b74] hover:underline font-bold uppercase tracking-wider font-display ${isBn ? 'font-bengali' : ''}`}
            >
              {isBn ? 'অন্য ইমেইল সাবস্ক্রাইব করুন →' : 'Subscribe another email \u2192'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-left">
            {/* Topic Preferences */}
            <div>
              <label className={`block text-xs font-bold text-[#1e0a3c] uppercase tracking-wider mb-2.5 font-display ${isBn ? 'font-bengali' : ''}`}>
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
                      className={`text-xs px-3 py-1.5 border font-mono font-medium transition-colors flex items-center gap-1.5 ${
                        isBn ? 'font-bengali' : ''
                      } ${
                        isChecked
                          ? 'bg-[#1e0a3c] border-[#1e0a3c] text-white font-bold'
                          : 'bg-[#ffffff] border-[#d9d9d9] text-[#6e6e6e] hover:bg-[#fdfbe4] hover:text-[#120424]'
                      }`}
                      style={{ borderRadius: 0 }}
                    >
                      <span
                        className={`w-1.5 h-1.5 ${
                          isChecked ? 'bg-[#d91b74]' : 'bg-[#d9d9d9]'
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
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e6e6e]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  required
                  className={`w-full pl-10 pr-4 py-2.5 bg-[#ffffff] border border-[#d9d9d9] text-[#120424] placeholder-[#6e6e6e] text-sm focus:outline-none focus:border-[#120424] transition-colors ${
                    isBn ? 'font-bengali' : ''
                  }`}
                  style={{ borderRadius: 0 }}
                />
              </div>

              <button
                type="submit"
                disabled={status === 'loading'}
                className={`px-6 py-2.5 bg-[#d91b74] hover:bg-[#bf1363] disabled:bg-[#d9d9d9] text-white font-bold text-xs uppercase tracking-wider font-display transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${
                  isBn ? 'font-bengali' : ''
                }`}
                style={{ borderRadius: 0 }}
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
              <div className="flex items-center gap-2 text-[#d91b74] text-xs mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className={isBn ? 'font-bengali' : ''}>{message}</span>
              </div>
            )}

            <p className={`text-center text-[11px] text-[#6e6e6e] font-mono pt-1 ${isBn ? 'font-bengali' : ''}`}>
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
