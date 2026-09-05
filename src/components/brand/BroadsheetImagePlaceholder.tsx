import React from 'react';

interface BroadsheetImagePlaceholderProps {
  category?: string;
  headline?: string;
  className?: string;
  aspectRatio?: '16/9' | '3/2' | '4/3' | 'auto';
}

export function BroadsheetImagePlaceholder({
  category = 'AI INTELLIGENCE',
  headline,
  className = '',
  aspectRatio = '16/9',
}: BroadsheetImagePlaceholderProps) {
  const aspectClass =
    aspectRatio === '16/9'
      ? 'aspect-[16/9]'
      : aspectRatio === '3/2'
      ? 'aspect-[3/2]'
      : aspectRatio === '4/3'
      ? 'aspect-[4/3]'
      : '';

  return (
    <div
      className={`relative w-full overflow-hidden bg-[#fdfbe4] border border-[#d9d9d9] flex flex-col justify-between p-4 select-none ${aspectClass} ${className}`}
      style={{ borderRadius: 0 }}
    >
      {/* Subtle broadsheet background rule lines */}
      <div className="absolute inset-0 opacity-5 pointer-events-none flex flex-col justify-between p-2">
        <div className="border-b border-[#120424]" />
        <div className="border-b border-[#120424]" />
        <div className="border-b border-[#120424]" />
        <div className="border-b border-[#120424]" />
      </div>

      {/* Top wire badge */}
      <div className="relative z-10 flex items-center justify-between text-[10px] font-mono tracking-wider uppercase text-[#1e0a3c]">
        <span className="flex items-center gap-1.5 font-bold">
          <span className="text-[#d91b74]">✦</span>
          <span>NAKSHATRA ARCHIVE</span>
        </span>
        <span className="px-1.5 py-0.5 bg-[#ffffff] border border-[#d9d9d9] text-[#6e6e6e]">
          {category}
        </span>
      </div>

      {/* Center abstract typographic mark */}
      <div className="relative z-10 my-auto text-center py-3">
        <div className="inline-block text-2xl sm:text-3xl text-[#1e0a3c]/30 font-display font-black tracking-widest uppercase">
          N∀KSH∀TR∀
        </div>
        {headline && (
          <div className="text-[11px] text-[#6e6e6e] font-serif italic max-w-xs mx-auto line-clamp-2 mt-1 px-2">
            &ldquo;{headline}&rdquo;
          </div>
        )}
      </div>

      {/* Bottom wire stamp */}
      <div className="relative z-10 flex items-center justify-between text-[9px] font-mono text-[#6e6e6e] border-t border-[#d9d9d9]/60 pt-1.5">
        <span>PRIMARY SOURCE VERIFIED</span>
        <span className="text-[#d91b74] font-bold">EVIDENCE GROUNDED</span>
      </div>
    </div>
  );
}
