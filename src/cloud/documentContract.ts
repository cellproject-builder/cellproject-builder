/** Persistence keys and credential sanitization are shared by browser backups and headless transfers. */
export const CLOUD_DOCUMENT_KEYS = ['cellproject-workspace', 'cellproject-graph', 'dynamic_diary-chat', 'cellproject-kb', 'cellproject-config', 'cellproject-locale', 'dynamic_diary-theme', 'dynamic_diary-sidebar-collapsed', 'dynamic_diary:task-view'] as const;
export function sanitizeCloudDocument(key: string, value: string): string {
  if (!CLOUD_DOCUMENT_KEYS.includes(key as typeof CLOUD_DOCUMENT_KEYS[number])) throw new Error('Documento de persistência desconhecido.');
  if (key !== 'cellproject-config') return value;
  const data = JSON.parse(value) as { state?: { providers?: Record<string, Record<string, unknown>> } };
  for (const config of Object.values(data.state?.providers ?? {})) delete config.apiKey;
  return JSON.stringify(data);
}
