import type { StateStorage } from 'zustand/middleware';

// Keep the backend fixed for this document, including after client navigation.
// A reload starts a new example session with an empty in-memory store.
const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
const publicDemo = pathname === '/demo' || pathname === '/demo/';
const values = new Map<string, string>();

export const isPublicDemo = (): boolean => publicDemo;
export const PUBLIC_DEMO_AI_MESSAGE = 'A IA está desativada nesta demonstração pública. Você pode editar os exemplos livremente; ao recarregar, as alterações são descartadas.';
export const PUBLIC_DEMO_NETWORK_MESSAGE = 'Esta demonstração pública funciona somente em memória e não acessa serviços externos nem dados da sua conta.';

export const demoStorage = {
  getItem: (name: string): string | null => values.get(name) ?? null,
  setItem: (name: string, value: string): void => { values.set(name, value); },
  removeItem: (name: string): void => { values.delete(name); },
} satisfies StateStorage;
