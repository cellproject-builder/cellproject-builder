import { useId, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '@/components/ui/SoftIcons';
import { useLocaleStore, useT } from '@/i18n';
import { TASK_STATUSES, type Task, type TaskStatus } from './types';
import { StatusIcon } from './TaskPresentation';
import { TaskRow } from './TaskRow';

interface TaskListProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onAdd: (status?: TaskStatus) => void;
  commentCounts: Record<string, number>;
}

export function TaskList({ tasks, onEdit, onAdd, commentCounts }: TaskListProps) {
  const tr = useT().workspace;
  const locale = useLocaleStore((state) => state.locale);
  const groupId = useId();
  const [collapsed, setCollapsed] = useState<Partial<Record<TaskStatus, boolean>>>({});

  return <div className="ws-issue-list" role="region" aria-label={tr.listView} tabIndex={0}>
    {TASK_STATUSES.map((status) => {
      const group = tasks.filter((task) => task.status === status).sort((a, b) => a.createdAt - b.createdAt);
      const isCollapsed = !!collapsed[status];
      const contentId = `${groupId}-${status}`;
      const headingId = `${contentId}-heading`;
      const toggleLabel = locale === 'en'
        ? `${isCollapsed ? 'Expand' : 'Collapse'} ${tr[status]}`
        : `${isCollapsed ? 'Expandir' : 'Recolher'} ${tr[status]}`;

      return <section className="ws-issue-group" key={status} aria-labelledby={headingId}>
        <div className="ws-issue-group-heading">
          <h2 id={headingId}><button
            className="ws-issue-group-toggle"
            aria-label={toggleLabel}
            aria-expanded={!isCollapsed}
            aria-controls={contentId}
            onClick={() => setCollapsed((current) => ({ ...current, [status]: !current[status] }))}
          >
            {isCollapsed ? <ChevronRightIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
            <StatusIcon status={status} />
            <span>{tr[status]}</span>
            <span className="ws-count">{group.length}</span>
          </button></h2>
          <button className="ws-icon-button" aria-label={`${tr.addTask} · ${tr[status]}`} onClick={() => onAdd(status)}>
            <PlusIcon aria-hidden="true" />
          </button>
        </div>
        <div id={contentId} hidden={isCollapsed}>
          {group.map((task) => <TaskRow key={task.id} task={task} onEdit={onEdit} commentCount={commentCounts[task.id] ?? 0} />)}
          {!group.length && <p className="ws-issue-list-empty">{tr.emptyColumn}</p>}
        </div>
      </section>;
    })}
  </div>;
}
