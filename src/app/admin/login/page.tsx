'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';

function LoginForm() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/admin/newsroom';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });

      const data = await res.json();
      if (data.success) {
        router.push(redirectPath);
        router.refresh();
      } else {
        setError(data.error || 'Invalid admin passphrase.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full mx-auto my-12 p-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-500 to-purple-600 p-0.5 mx-auto flex items-center justify-center shadow-lg shadow-sky-500/20">
          <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
            <Lock className="w-5 h-5 text-sky-400" />
          </div>
        </div>
        <h1 className="text-xl font-extrabold text-white">Newsroom Access Gate</h1>
        <p className="text-xs text-slate-400">
          Authorized editorial access required to manage autonomous agents and publish intelligence.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            Admin Secret Passphrase
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Enter ADMIN_API_SECRET..."
            required
            className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || secret.length === 0}
          className="w-full py-2.5 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20"
        >
          {isLoading ? 'Verifying...' : 'Unlock Newsroom'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      <div className="pt-2 text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        Timing-safe cryptographic verification enforced
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400 text-xs">Loading authentication gate...</div>}>
      <LoginForm />
    </Suspense>
  );
}
