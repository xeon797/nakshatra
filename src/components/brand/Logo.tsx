import React from 'react';
import Link from 'next/link';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
}

export function Logo({ className = '', size = 'md', asLink = true }: LogoProps) {
  const content = (
    <div className={`inline-flex items-center gap-2 select-none ${className}`}>
      <span
        className={`font-black font-display text-[#120424] ${
          size === 'lg'
            ? 'text-3xl sm:text-4xl tracking-[-0.025em]'
            : size === 'sm'
            ? 'text-lg tracking-[-0.015em]'
            : 'text-xl sm:text-2xl tracking-[-0.02em]'
        }`}
      >
        N∀KSH∀TR∀
      </span>
      <span className="text-[#d9d9d9] font-light text-base">|</span>
      <span
        className={`font-bengali font-bold text-[#1e0a3c] ${
          size === 'lg' ? 'text-2xl sm:text-3xl' : size === 'sm' ? 'text-base' : 'text-lg sm:text-xl'
        }`}
      >
        নক্ষত্র
      </span>
      <span className="text-[#d91b74] text-sm sm:text-base font-bold">✦</span>
    </div>
  );

  if (asLink) {
    return (
      <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
        {content}
      </Link>
    );
  }

  return content;
}
