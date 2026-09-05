import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        broadsheet: {
          magenta: '#d91b74',
          plum: '#1e0a3c',
          ink: '#120424',
          cream: '#fdfcf3',
          white: '#ffffff',
          margin: '#fdfbe4',
          evidence: '#f1ebfc',
          hairline: '#d9d9d9',
          caption: '#6e6e6e',
          mute: '#b3b3b3',
          violet: '#7b3fe4',
        },
        primary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          900: '#064e3b',
        },
      },
      fontFamily: {
        display: ['var(--font-satoshi)', 'sans-serif'],
        sans: ['var(--font-body)', 'sans-serif'],
        bengali: ['var(--font-bengali)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
