import { CalendarIcon, ChatBubbleIcon, Link2Icon } from '@/components/ui/SoftIcons';
import { useT } from '@/i18n';
import type { Task } from './types';
import { PriorityMark, TaskStatusControl, taskReference } from './TaskPresentation';
import { shortDate } from './ui';

export const TASK_DRAG_TYPE = 'application/cellproject-task';

export function TaskCard({ task, commentCount, onEdit, onDragEnd }: {
  task: Task;
  commentCount: number;
  onEdit: (task: Task) => void;
  onDragEnd: () => void;
}) {
  const tr = useT().workspace;
  return <article className="ws-issue-card" data-priority={task.priority} draggable onDragStart={(e) => {
    e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
    e.dataTransfer.effectAllowed = 'move';
  }} onDragEnd={onDragEnd}>
    <div className="ws-issue-card-top">
      <span className="ws-issue-reference" title={task.id}>{taskReference(task)}</span>
      {task.sourceNodeId && <span className="ws-issue-card-origin" title={tr.planOrigin}><Link2Icon aria-hidden="true" />{tr.planOrigin}</span>}
      <TaskStatusControl task={task} />
    </div>
    <div className="ws-issue-card-title">
      <button onClick={() => onEdit(task)}>{task.title}</button>
    </div>
    <div className="ws-issue-card-footer">
      <div className="ws-issue-card-meta">
        {task.dueDate && <time dateTime={task.dueDate} title={`${tr.dueDate}: ${shortDate(task.dueDate)}`}><CalendarIcon aria-hidden="true" />{shortDate(task.dueDate)}</time>}
        {commentCount > 0 && <span title={`${tr.comments}: ${commentCount}`} aria-label={`${tr.comments}: ${commentCount}`}><ChatBubbleIcon aria-hidden="true" />{commentCount}</span>}
      </div>
      <span className="ws-issue-card-priority" role="img" aria-label={`${tr.priority}: ${tr[task.priority]}`}><PriorityMark priority={task.priority} showLabel /></span>
    </div>
  </article>;
}
