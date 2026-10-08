import { useLocaleStore, LOCALE_LABELS, type Locale } from '@/i18n';
import { useT } from '@/i18n';

const LOCALES: Locale[] = ['en', 'pt-BR'];
// Rótulo visível curto; o nome acessível continua sendo o nome completo do idioma.
const SHORT: Record<Locale, string> = { en: 'EN', 'pt-BR': 'PT' };

interface Props {
  className?: string;
}

// Seletor de idioma compacto: um controle segmentado pequeno (estilo macOS),
// discreto o bastante para ficar no canto de um cabeçalho sem competir com ele.
export function LanguageToggle({ className }: Props) {
  const tr = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <div role="radiogroup" aria-label={tr.language.label} className={`segmented ${className ?? ''}`}>
      {LOCALES.map((l) => {
        const active = locale === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={LOCALE_LABELS[l]}
            title={LOCALE_LABELS[l]}
            onClick={() => setLocale(l)}
            className="segmented-item !px-2 text-caption"
          >
            {SHORT[l]}
          </button>
        );
      })}
    </div>
  );
}
