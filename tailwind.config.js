import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './node_modules/streamdown/dist/*.js'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        gray: {
          ...colors.stone,
          50: '#f7f2e8',
          100: '#efe7d7',
          950: '#16120d',
        },
        // Brand accent: remap Tailwind "blue" to Centaur terracotta/clay so every
        // hardcoded blue-* accent (active tabs, primary buttons, rings, toasts) follows the brand.
        blue: {
          50: '#fbf3ec',
          100: '#f6e1d2',
          200: '#ecc4a4',
          300: '#e0a274',
          400: '#d2824d',
          500: '#c2693c',
          600: '#ab5a32',
          700: '#8c4a2b',
          800: '#723d27',
          900: '#5e3422',
          950: '#341a10',
        },
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
