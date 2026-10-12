/** Shared ingestion limits and identity do not depend on PDF extraction or AI. */
export const MAX_CHARS = 40_000;

// Existing djb2 identity remains compatible with documents already in the vault.
export function fingerprintText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}
