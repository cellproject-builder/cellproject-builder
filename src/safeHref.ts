// Só http(s) vira href — nada de javascript:, data: etc. vindos da IA/import.
export function safeHref(value: string): string | null {
  const v = (value ?? '').trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
