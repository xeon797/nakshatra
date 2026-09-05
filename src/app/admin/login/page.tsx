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
    <div
      className="max-w-md w-full mx-auto my-12 p-8 bg-[#ffffff] border border-[#d9d9d9] space-y-6"
      style={{ borderRadius: 0 }}
    >
      <div className="text-center space-y-2">
        <div
          className="w-12 h-12 bg-[#f1ebfc] border border-[#d9d9d9] mx-auto flex items-center justify-center text-[#1e0a3c]"
          style={{ borderRadius: 0 }}
        >
          <Lock className="w-5 h-5 text-[#1e0a3c]" />
        </div>
        <h1 className="text-xl font-bold font-display text-[#120424]">Newsroom Access Gate</h1>
        <p className="text-xs text-[#6e6e6e]">
          Authorized editorial access required to manage autonomous agents and publish intelligence.
        </p>
      </div>

      {error && (
        <div
          className="p-3 bg-[#fdfcf3] border border-[#d91b74] text-[#d91b74] text-xs font-mono flex items-center gap-2"
          style={{ borderRadius: 0 }}
        >
          <AlertCircle className="w-4 h-4 text-[#d91b74] shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-bold font-display text-[#1e0a3c] uppercase tracking-wider block">
            Admin Secret Passphrase
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Enter ADMIN_API_SECRET..."
            required
            className="w-full px-4 py-2.5 bg-[#ffffff] border border-[#d9d9d9] text-[#120424] placeholder-[#6e6e6e] text-sm focus:outline-none focus:border-[#120424] transition-colors"
            style={{ borderRadius: 0 }}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || secret.length === 0}
          className="w-full py-2.5 px-4 bg-[#1e0a3c] hover:bg-[#120424] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider font-display transition-colors flex items-center justify-center gap-2"
          style={{ borderRadius: 0 }}
        >
          {isLoading ? 'Verifying...' : 'Unlock Newsroom'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      <div className="pt-2 text-center text-[11px] text-[#6e6e6e] font-mono flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-[#1e0a3c]" />
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
