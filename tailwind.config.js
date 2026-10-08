/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-primary': '#09090b',
        'bg-secondary': '#18181b',
        'bg-elevated': '#27272a',
        'border-base': '#3f3f46',
        'text-primary': '#f4f4f5',
        // Contraste AA sobre bg-primary/secondary: secondary ~13:1, muted ~7:1,
        // faint ~5:1 (o antigo #71717a ficava abaixo de 4.5:1 em bg-elevated).
        'text-secondary': '#d4d4d8',
        'text-muted': '#a1a1aa',
        'text-faint': '#8b8b94',
        'conf-high': '#22c55e',
        'conf-mid': '#f59e0b',
        'conf-low': '#ef4444',
        'conn-direct': '#22c55e',
        'conn-middleware': '#f59e0b',
        'conn-independent': '#6366f1',
        'conn-optional': '#94a3b8',
        'state-concept': '#71717a',
        'state-validated': '#f4f4f5',
        'state-executing': '#3b82f6',
        'state-done': '#22c55e',
        'state-problem': '#ef4444',
        'state-discarded': '#3f3f46',
        'ai-accent': '#8b5cf6',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};
