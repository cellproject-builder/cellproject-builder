import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { toast } from '@/components/ui/Toast';

const paths = {
  projects: 'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3',
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  kanban: 'M4 4h4v16H4z M10 4h4v11h-4z M16 4h4v14h-4z',
  scrum: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5 M12 7v5l3 2',
  notes: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
  planner: 'M12 3v6 M5 15v-4h14v4 M12 11v4 M3 16h4v5H3z M10 16h4v5h-4z M17 16h4v5h-4z',
  plus: 'M12 5v14 M5 12h14', search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6',
  arrow: 'M5 12h14 M13 6l6 6-6 6', close: 'M6 6l12 12 M6 18L18 6',
  folder: 'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3',
  pin: 'M8 3h8l-1 6 4 4H5l4-4z M12 13v8',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  check: 'M5 12l4 4L19 6', edit: 'M15 4l5 5 M4 20l5-1L21 7l-5-5L4 14z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
} as const;
export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function Empty({ icon = 'projects', title, hint, children }: { icon?: keyof typeof paths; title: string; hint?: string; children?: ReactNode }) {
  return <div className="ws-empty"><div className="ws-empty-icon"><Icon name={icon} size={32} /></div><h3>{title}</h3>{hint && <p>{hint}</p>}{children}</div>;
}
export function attempt<T>(fn: () => T): T | undefined {
  try { return fn(); } catch (error) {
    const errors = t().workspace.errors;
    const key = error instanceof Error ? error.message : 'unknown';
    toast.show({ message: errors[key as keyof typeof errors] ?? errors.unknown, tone: 'warn' });
    return undefined;
  }
}
export function shortDate(value: string | number) {
  const locale = document.documentElement.lang || 'pt-BR';
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}
