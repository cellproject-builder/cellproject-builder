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
