import { useLocaleStore } from './store';
import { en, ptBR, type Messages } from './messages';

export { useLocaleStore, LOCALE_LABELS, LOCALE_AI_NAMES, currentLocale, currentLocaleAIName } from './store';
export type { Locale } from './store';
export type { Messages } from './messages';

const bundles: Record<'en' | 'pt-BR', Messages> = {
  en,
  'pt-BR': ptBR,
};

// React hook — re-renders when locale changes.
export function useT(): Messages {
  const locale = useLocaleStore((s) => s.locale);
  return bundles[locale];
}

// For non-component code (prompts, services, store actions).
export function t(): Messages {
  return bundles[useLocaleStore.getState().locale];
}
