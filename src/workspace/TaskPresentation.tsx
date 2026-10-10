import { ArrowDownIcon, ArrowUpIcon, BarChartIcon, CheckCircledIcon, CircleIcon, CountdownTimerIcon, Half2Icon } from '@/components/ui/SoftIcons';
import { useT } from '@/i18n';
import { useWorkspaceStore } from './store';
import { TASK_STATUSES, type Priority, type Task, type TaskStatus } from './types';
import { attempt } from './ui';

/** A short display reference; the original task ID remains the persisted identity. */
export function taskReference(task: Task) {
  return `DD-${task.id.slice(-6).toUpperCase()}`;
}

const statusIcons = { todo: CircleIcon, doing: Half2Icon, review: CountdownTimerIcon, done: CheckCircledIcon };
export function StatusIcon({ status }: { status: TaskStatus }) {
  const Glyph = statusIcons[status];
  return <Glyph className={`ws-issue-status ${status}`} width={14} height={14} aria-hidden="true" />;
}

/** Native select retains keyboard/touch access while showing a compact status icon. */
export function TaskStatusControl({ task }: { task: Task }) {
  const tr = useT().workspace;
  return <label className="ws-issue-status-control" title={`${tr.status}: ${tr[task.status]}`}>
    <StatusIcon status={task.status} />
    <select id={`task-status-${task.id}`} aria-label={`${tr.status}: ${task.title}`} value={task.status}
      onChange={(e) => {
        const select = e.currentTarget;
        const restoreFocus = select.ownerDocument.activeElement === select;
        const status = select.value as TaskStatus;
        if (status === task.status) return;
        attempt(() => {
          useWorkspaceStore.getState().updateTask(task.id, { status });
          // Changing a group remounts this control; keep keyboard navigation at the task.
          if (restoreFocus) requestAnimationFrame(() => {
            const next = select.ownerDocument.getElementById(`task-status-${task.id}`);
            const target = next?.closest('[hidden]')
              ? next.closest('section')?.querySelector<HTMLButtonElement>('[aria-expanded]')
              : next;
            (target as HTMLElement | null)?.focus();
          });
        });
      }}>
      {TASK_STATUSES.map((status) => <option key={status} value={status}>{tr[status]}</option>)}
    </select>
  </label>;
}

const priorityIcons = { low: ArrowDownIcon, medium: BarChartIcon, high: ArrowUpIcon };
export function PriorityMark({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  const tr = useT().workspace;
  const Glyph = priorityIcons[priority];
  return <span className={`ws-issue-priority ${priority} ${showLabel ? 'is-chip' : ''}`} title={`${tr.priority}: ${tr[priority]}`}>
    <Glyph width={15} height={15} role="img" aria-label={`${tr.priority}: ${tr[priority]}`} />
    {showLabel && <span>{tr[priority]}</span>}
  </span>;
}
