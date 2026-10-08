/** @type {import('tailwindcss').Config} */

// Todas as cores vêm de variáveis CSS em canais RGB (definidas em src/index.css
// para o tema claro, o escuro via prefers-color-scheme e o override
// :root[data-theme]). Assim `bg-ai-accent/10` etc. continuam funcionando.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const EASE_MAC = 'cubic-bezier(.2,.8,.2,1)';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // O tema segue o sistema pelas variáveis CSS. Prefira tokens a `dark:`.
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        'bg-primary': token('bg-primary'),
        'bg-secondary': token('bg-secondary'),
        'bg-elevated': token('bg-elevated'),
        'border-base': token('border-base'),
        'text-primary': token('text-primary'),
        'text-secondary': token('text-secondary'),
        'text-muted': token('text-muted'),
        'text-faint': token('text-faint'),
        accent: token('accent'),
        'accent-solid': token('accent-solid'),
        'accent-fg': token('accent-fg'),
        'ai-accent': token('ai-accent'),
        'conf-high': token('conf-high'),
        'conf-mid': token('conf-mid'),
        'conf-low': token('conf-low'),
        'conn-direct': token('conn-direct'),
        'conn-middleware': token('conn-middleware'),
        'conn-independent': token('conn-independent'),
        'conn-optional': token('conn-optional'),
        'state-concept': token('state-concept'),
        'state-validated': token('state-validated'),
        'state-executing': token('state-executing'),
        'state-done': token('state-done'),
        'state-problem': token('state-problem'),
        'state-discarded': token('state-discarded'),
        glass: token('glass'),
        hairline: token('hairline'),
        scrim: token('scrim'),
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          'Inter',
          '"Segoe UI Variable"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', '"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      // Escala estilo HIG. Tracking levemente negativo a partir de 17px.
      fontSize: {
        caption: ['11px', { lineHeight: '14px' }],
        footnote: ['12px', { lineHeight: '16px' }],
        control: ['13px', { lineHeight: '18px' }],
        body: ['15px', { lineHeight: '1.55' }],
        title3: ['17px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        title2: ['22px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        title1: ['28px', { lineHeight: '34px', letterSpacing: '-0.015em' }],
      },
      borderRadius: {
        window: '14px',
        card: '12px',
        control: '8px',
        chip: '6px',
        check: '5px',
      },
      boxShadow: {
        'mac-sm': 'var(--shadow-mac-sm)',
        mac: 'var(--shadow-mac)',
        'mac-lg': 'var(--shadow-mac-lg)',
      },
      transitionTimingFunction: {
        mac: EASE_MAC,
      },
      transitionDuration: {
        120: '120ms',
        180: '180ms',
        240: '240ms',
      },
      // Habilita /12 (seleção estilo Finder: bg-accent/12) e /8.
      opacity: {
        8: '0.08',
        12: '0.12',
      },
      maxWidth: {
        read: '68ch',
      },
      animation: {
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
        'sheet-in': `sheet-in 180ms ${EASE_MAC} both`,
        'scrim-in': `scrim-in 180ms ${EASE_MAC} both`,
        'toast-in': 'toast-in 260ms cubic-bezier(.2,1.25,.35,1) both',
        // backwards: nenhum transform residual depois da animação (ele quebrava a
        // pintura da barra sticky do tutor).
        'card-swap': `card-swap 240ms ${EASE_MAC} backwards`,
        'check-draw': `check-draw 200ms ${EASE_MAC} both`,
      },
      keyframes: {
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'sheet-in': {
          from: { opacity: '0', transform: 'scale(.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'scrim-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(.96)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'card-swap': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Use com stroke-dasharray/stroke-dashoffset = comprimento do traço (pathLength=1).
        'check-draw': {
          from: { strokeDashoffset: '1' },
          to: { strokeDashoffset: '0' },
        },
      },
    },
  },
  plugins: [],
};
