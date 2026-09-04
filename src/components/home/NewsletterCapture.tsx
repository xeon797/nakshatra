'use client';

import React, { useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';

const TOPIC_OPTIONS = [
  { id: 'models', label: 'Models & LLMs' },
  { id: 'agents', label: 'Autonomous Agents' },
  { id: 'infra', label: 'AI Infrastructure' },
  { id: 'research', label: 'Research Papers' },
  { id: 'policy', label: 'Policy & Safety' },
];

export function NewsletterCapture() {
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
      setMessage('Please enter a valid email address.');
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
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus('success');
        setMessage(data.message || 'You have successfully subscribed to NAKSHATRA Daily.');
        setEmail('');
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to subscribe. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
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
          Zero-Hallucination Intelligence Briefing
        </div>

        <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          Stay Ahead of Frontier AI Breakthroughs
        </h2>

        <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
          Receive a daily executive digest synthesized autonomously from verified technical reports and primary lab documentation. No speculative noise, zero verbatim copy.
        </p>

        {status === 'success' ? (
          <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-8 h-8" />
            <h3 className="font-bold text-lg text-white">Subscription Confirmed</h3>
            <p className="text-sm text-slate-300">{message}</p>
            <button
              onClick={() => setStatus('idle')}
              className="mt-3 text-xs text-sky-400 hover:underline font-medium"
            >
              Subscribe another email &rarr;
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-left">
            {/* Topic Preferences */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                Customize Topic Preferences
              </label>
              <div className="flex flex-wrap gap-2">
                {TOPIC_OPTIONS.map((t) => {
                  const isChecked = selectedTopics.includes(t.id);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggleTopic(t.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all font-medium flex items-center gap-1.5 ${
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
                      {t.label}
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
                  placeholder="Enter your work email (e.g. researcher@openai.com)"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Subscribing...
                  </>
                ) : (
                  'Subscribe Free'
                )}
              </button>
            </div>

            {status === 'error' && (
              <div className="flex items-center gap-2 text-rose-400 text-xs mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{message}</span>
              </div>
            )}

            <p className="text-center text-[11px] text-slate-500 pt-1">
              Join 12,000+ AI researchers and engineers. Unsubscribe anytime with 1-click.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
