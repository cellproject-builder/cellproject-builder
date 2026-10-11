import type { ReactNode } from 'react';
import { CalendarIcon, ChatBubbleIcon, Link2Icon } from '@/components/ui/SoftIcons';
import { useT } from '@/i18n';
import type { Task } from './types';
import { PriorityMark, StatusIcon, TaskStatusControl, taskReference } from './TaskPresentation';
import { shortDate } from './ui';

/** The same reading order and fixed metadata tracks in lists and sprint collections. */
export function TaskRow({ task, onEdit, commentCount = 0, trailing, readOnlyStatus = false }: {
  task: Task;
  onEdit: (task: Task) => void;
  commentCount?: number;
  trailing?: ReactNode;
  readOnlyStatus?: boolean;
}) {
  const tr = useT().workspace;
  return <article className={`ws-issue-row${trailing ? ' has-trailing' : ''}`}>
    {readOnlyStatus ? <span className="ws-issue-readonly-status" title={`${tr.status}: ${tr[task.status]}`} aria-label={`${tr.status}: ${tr[task.status]}`}><StatusIcon status={task.status} /></span> : <TaskStatusControl task={task} />}
    <PriorityMark priority={task.priority} />
    <span className="ws-issue-reference" title={task.id}>{taskReference(task)}</span>
    <div className="ws-issue-row-content">
      <button className="ws-issue-row-title" onClick={() => onEdit(task)} title={task.title}>{task.title}</button>
      <div className="ws-issue-row-signals">
        {task.sourceNodeId && <span title={tr.planOrigin} aria-label={tr.planOrigin}><Link2Icon aria-hidden="true" /></span>}
        {commentCount > 0 && <span title={`${tr.comments}: ${commentCount}`} aria-label={`${tr.comments}: ${commentCount}`}><ChatBubbleIcon aria-hidden="true" />{commentCount}</span>}
      </div>
    </div>
    <div className="ws-issue-row-date">
      {task.dueDate && <time dateTime={task.dueDate} title={`${tr.dueDate}: ${shortDate(task.dueDate)}`}><CalendarIcon aria-hidden="true" />{shortDate(task.dueDate)}</time>}
    </div>
    {trailing && <div className="ws-issue-row-trailing">{trailing}</div>}
  </article>;
}
