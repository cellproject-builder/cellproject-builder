import { useLocaleStore, LOCALE_LABELS, type Locale } from '@/i18n';
import { useT } from '@/i18n';

const LOCALES: Locale[] = ['en', 'pt-BR'];

interface Props {
  className?: string;
}

// Self-explanatory language picker: globe glyph + segmented pills, all in one
// pill-shaped container. No external label needed — the globe communicates
// the purpose, the pills communicate the choices.
export function LanguageToggle({ className }: Props) {
  const tr = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <div
      role="radiogroup"
      aria-label={tr.language.label}
      className={`inline-flex items-center gap-0.5 bg-bg-secondary border border-border-base rounded-sm p-0.5 ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        title={tr.language.label}
        className="flex items-center justify-center px-1.5 text-text-muted"
      >
        <GlobeGlyph />
      </span>
      {LOCALES.map((l) => {
        const active = locale === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setLocale(l)}
            className={`px-2 py-1 text-[11px] font-mono rounded-[2px] transition-colors leading-none ${
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
  );
}

function GlobeGlyph() {
  return (
    <svg
      width="12"
      height="12"
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
