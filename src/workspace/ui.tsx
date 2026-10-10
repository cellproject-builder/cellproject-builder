import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { toast } from '@/components/ui/Toast';
import { ArrowRightIcon, CheckIcon, CloseIcon, DashboardIcon, FolderIcon, FolderOpenIcon, GearIcon, HistoryIcon, MenuIcon, NotesIcon, Pencil1Icon, PinIcon, PlannerIcon, PlusIcon, SearchIcon, TrashIcon, ViewVerticalIcon } from '@/components/ui/SoftIcons';

const icons = {
  projects: FolderOpenIcon, overview: DashboardIcon, kanban: ViewVerticalIcon, scrum: HistoryIcon,
  notes: NotesIcon, planner: PlannerIcon, plus: PlusIcon, search: SearchIcon, arrow: ArrowRightIcon,
  close: CloseIcon, folder: FolderIcon, pin: PinIcon, trash: TrashIcon, check: CheckIcon,
  edit: Pencil1Icon, settings: GearIcon, menu: MenuIcon,
} as const;
export function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  const Glyph = icons[name];
  return <Glyph size={size} />;
}
export function Empty({ icon = 'projects', title, hint, children }: { icon?: keyof typeof icons; title: string; hint?: string; children?: ReactNode }) {
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
