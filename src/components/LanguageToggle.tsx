import { useLocaleStore, LOCALE_LABELS, type Locale } from '@/i18n';
import { useT } from '@/i18n';

const LOCALES: Locale[] = ['en', 'pt-BR'];

interface Props {
  className?: string;
}

// Minimal language picker — text-only with a tiny separator. Looks like
// auxiliary text (a footer hint), not a primary control. Stays out of the
// content header's way on tight mobile screens while remaining tappable.
export function LanguageToggle({ className }: Props) {
  const tr = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <div
      role="radiogroup"
      aria-label={tr.language.label}
      className={`inline-flex items-center gap-1 font-mono text-[10px] ${className ?? ''}`}
    >
      {LOCALES.map((l, i) => {
        const active = locale === l;
        return (
          <span key={l} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="text-text-muted/40">/</span>}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(l)}
              className={`uppercase tracking-wider px-1 py-0.5 transition-colors ${
                active
                  ? 'text-ai-accent'
                  : 'text-text-muted/70 hover:text-text-secondary'
              }`}
            >
              {LOCALE_LABELS[l]}
            </button>
          </span>
        );
      })}
    </div>
  );
}
