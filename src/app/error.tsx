'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Newspaper } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[NAKSHATRA] Application runtime error caught by boundary:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12 px-4">
      <div
        className="max-w-xl w-full bg-[#ffffff] border border-[#d9d9d9] p-8 sm:p-12 text-center space-y-6"
        style={{ borderRadius: 0 }}
      >
        <div className="w-12 h-12 bg-[#fdfbe4] border border-[#d9d9d9] flex items-center justify-center mx-auto text-[#d91b74]">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <div className="inline-block px-2.5 py-0.5 bg-[#f1ebfc] text-[#1e0a3c] border border-[#d9d9d9] font-mono text-xs uppercase tracking-wider font-bold">
            Telemetry Alert
          </div>
          <h2 className="text-2xl sm:text-3xl font-black font-display text-[#120424] tracking-tight">
            Transient System Exception
          </h2>
          <p className="text-sm text-[#6e6e6e] max-w-md mx-auto">
            The autonomous intelligence desk encountered a temporary issue loading this view. Our background telemetry has logged this event.
          </p>
          {error.digest && (
            <p className="text-xs font-mono text-[#6e6e6e]/80 pt-1">
              Incident Digest: <span className="text-[#120424] font-semibold">{error.digest}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#d91b74] hover:bg-[#bf1363] text-white font-bold text-xs uppercase tracking-wider font-display transition-colors"
            style={{ borderRadius: 0 }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Connection</span>
          </button>

          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#ffffff] hover:bg-[#fdfbe4] text-[#120424] border border-[#d9d9d9] font-bold text-xs uppercase tracking-wider font-display transition-colors"
            style={{ borderRadius: 0 }}
          >
            <Newspaper className="w-3.5 h-3.5 text-[#1e0a3c]" />
            <span>Return to Live Feed</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
