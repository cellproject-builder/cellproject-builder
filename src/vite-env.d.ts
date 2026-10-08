/// <reference types="vite/client" />

// BYOK: a chave de API vive no IndexedDB do navegador, não em env.
// Mantemos apenas a tipagem genérica do import.meta.env.
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly PROD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injetado pelo vite.config só em `vite serve` (string vazia no build).
declare const __DEV_OPENROUTER_KEY__: string;
