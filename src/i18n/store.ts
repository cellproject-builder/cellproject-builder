import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

export type Locale = 'en' | 'pt-BR';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (BR)',
};

export const LOCALE_AI_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Brazilian Portuguese',
};

function detectInitialLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language ?? '').toLowerCase();
  return lang.startsWith('pt') ? 'pt-BR' : 'en';
}

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await idbDel(name);
  },
};

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: detectInitialLocale(),
      setLocale: (l) => set({ locale: l }),
    }),
    {
      name: 'cellproject-locale',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
    },
  ),
);

export function currentLocale(): Locale {
  return useLocaleStore.getState().locale;
}

export function currentLocaleAIName(): string {
  return LOCALE_AI_NAMES[currentLocale()];
}
