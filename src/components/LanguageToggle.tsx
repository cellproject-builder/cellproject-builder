import {
  useLocaleStore,
  LOCALE_LABELS,
  type Locale,
} from '@/i18n';
import { useT } from '@/i18n';

const LOCALES: Locale[] = ['en', 'pt-BR'];

type Variant = 'default' | 'compact';

interface Props {
  variant?: Variant;
  className?: string;
}

// Segmented language toggle — used in ApiKeyGate and ObjectiveScreen so users
// can switch language without hunting for a hidden dropdown.
export function LanguageToggle({ variant = 'default', className }: Props) {
  const tr = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const showLabel = variant === 'default';

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {showLabel && (
        <span
          aria-hidden="true"
          className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-text-muted"
        >
          <GlobeGlyph />
          <span>{tr.language.label}</span>
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={tr.language.label}
        className="flex items-center gap-0.5 bg-bg-secondary border border-border-base rounded-sm p-0.5"
      >
        {LOCALES.map((l) => {
          const active = locale === l;
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(l)}
              className={`px-2.5 py-1 text-[11px] font-mono rounded-[2px] transition-colors min-h-[28px] ${
                active
                  ? 'bg-ai-accent/15 text-ai-accent'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {LOCALE_LABELS[l]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Minimal globe glyph — three meridians + equator. SVG so it stays crisp.
function GlobeGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.9"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" />
      <ellipse cx="6" cy="6" rx="2" ry="4.5" />
      <line x1="1.5" y1="6" x2="10.5" y2="6" />
    </svg>
  );
}
