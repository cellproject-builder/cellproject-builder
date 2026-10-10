import { useMemo, useState } from 'react';
import { PlusIcon, RowsIcon, ViewVerticalIcon } from '@radix-ui/react-icons';
import { useT } from '@/i18n';
import { useWorkspaceStore } from './store';
import { TASK_STATUSES, type Task, type TaskStatus } from './types';
import { Empty, Icon, attempt } from './ui';
import { PageHeader } from './PageHeader';
import { TaskCard, TASK_DRAG_TYPE } from './TaskCard';
import { TaskList } from './TaskList';
import { StatusIcon, taskReference } from './TaskPresentation';
import './Board.css';

type TaskView = 'board' | 'list';
const VIEW_KEY = 'dynamic_diary:task-view';
function initialView(): TaskView {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; }
}

export function Board({ projectId, onEdit, onAdd }: { projectId: string; onEdit: (task: Task) => void; onAdd: (status?: TaskStatus) => void }) {
  const tr = useT().workspace;
  const allTasks = useWorkspaceStore((s) => s.tasks);
  const comments = useWorkspaceStore((s) => s.comments);
  const [view, setView] = useState<TaskView>(initialView);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('');
  const [over, setOver] = useState<TaskStatus | null>(null);
  const tasks = Object.values(allTasks).filter((task) => task.projectId === projectId &&
    `${task.title} ${task.description} ${taskReference(task)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!priority || task.priority === priority));
  const commentCounts = useMemo(() => Object.values(comments).reduce<Record<string, number>>((counts, comment) => {
    counts[comment.taskId] = (counts[comment.taskId] ?? 0) + 1;
    return counts;
  }, {}), [comments]);
  const changeView = (next: TaskView) => {
    setView(next); setOver(null);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* View selection still works without storage. */ }
  };
  return <div className="ws-page ws-board-page">
    <PageHeader title={tr.kanban} controls={<>
      <label className="ws-search"><Icon name="search" /><input aria-label={tr.searchTasks} placeholder={tr.searchTasks} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <select className="ws-select" aria-label={tr.priority} value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">{tr.allPriorities}</option>{(['low', 'medium', 'high'] as const).map((p) => <option key={p} value={p}>{tr[p]}</option>)}</select>
      <div className="ws-segmented ws-view-switch" role="group" aria-label={tr.taskView}>
        <button aria-label={tr.boardView} title={tr.boardView} aria-pressed={view === 'board'} className={view === 'board' ? 'selected' : ''} onClick={() => changeView('board')}><ViewVerticalIcon aria-hidden="true" /></button>
        <button aria-label={tr.listView} title={tr.listView} aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => changeView('list')}><RowsIcon aria-hidden="true" /></button>
      </div>
    </>} actions={<button className="ws-button primary" onClick={() => onAdd()}><PlusIcon aria-hidden="true" />{tr.newTask}</button>} />
    {tasks.length === 0 && (query || priority) ? <Empty icon="kanban" title={tr.noResults} hint={tr.noResultsHint} /> : view === 'list' ?
      <TaskList tasks={tasks} onEdit={onEdit} onAdd={onAdd} commentCounts={commentCounts} /> :
      <div className="ws-board">{TASK_STATUSES.map((status) => {
      const column = tasks.filter((t) => t.status === status).sort((a, b) => a.createdAt - b.createdAt);
      return <section key={status} aria-label={tr[status]} className={`ws-column ${over === status ? 'drag-over' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(status); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }} onDrop={(e) => {
        e.preventDefault(); setOver(null);
        const id = e.dataTransfer.getData(TASK_DRAG_TYPE);
        if (allTasks[id]?.projectId === projectId && allTasks[id].status !== status) attempt(() => useWorkspaceStore.getState().updateTask(id, { status }));
      }}>
        <div className="ws-column-heading"><StatusIcon status={status} /><h2>{tr[status]}</h2><span className="ws-count">{column.length}</span><button className="ws-icon-button" aria-label={`${tr.addTask} · ${tr[status]}`} onClick={() => onAdd(status)}><PlusIcon aria-hidden="true" /></button></div>
        <div className="ws-column-content">
          {column.map((task) => <TaskCard key={task.id} task={task} commentCount={commentCounts[task.id] ?? 0} onEdit={onEdit} onDragEnd={() => setOver(null)} />)}
          {!column.length && <p className="ws-column-empty">{tr.emptyColumn}</p>}
          <button className="ws-column-add" onClick={() => onAdd(status)}><PlusIcon aria-hidden="true" />{tr.addTask}</button>
        </div>
      </section>;
    })}</div>}
  </div>;
}
