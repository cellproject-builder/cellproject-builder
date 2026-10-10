import { AudioTextarea, AudioTextInput } from '@/audio/AudioField';
import { useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useWorkspaceStore } from './store';
import { TASK_STATUSES, type TaskInput, type Task, type TaskStatus, type Priority } from './types';
import { attempt, Icon } from './ui';
import { Comments } from './Comments';

export function TaskEditor({ projectId, task, initialStatus = 'todo', onClose, onSource }: { projectId: string; task?: Task; initialStatus?: TaskStatus; onClose: () => void; onSource: (task: Task) => void }) {
  const tr = useT().workspace;
  const sprints = useWorkspaceStore((s) => s.sprints);
  const [draft, setDraft] = useState<TaskInput>({ title: task?.title ?? '', description: task?.description ?? '', status: task?.status ?? initialStatus, priority: task?.priority ?? 'medium', dueDate: task?.dueDate ?? '', sprintId: task?.sprintId ?? null });
  const patch = (value: Partial<TaskInput>) => setDraft((d) => ({ ...d, ...value }));
  return <Modal open onClose={onClose} title={task ? tr.editTask : tr.newTask}>
    <form className="ws-form" onSubmit={(e) => { e.preventDefault(); attempt(() => {
      const store = useWorkspaceStore.getState();
      if (task) store.updateTask(task.id, draft); else store.createTask(projectId, draft);
      onClose();
    }); }}>
      <label>{tr.taskTitle}<AudioTextInput audioScope={`task:${task?.id ?? `${projectId}:new`}:title`} required autoFocus value={draft.title} placeholder={tr.taskPlaceholder} onChange={(e) => patch({ title: e.target.value })} maxLength={240} /></label>
      <label>{tr.description}<AudioTextarea audioScope={`task:${task?.id ?? `${projectId}:new`}:description`} rows={5} value={draft.description} placeholder={tr.descriptionPlaceholder} onChange={(e) => patch({ description: e.target.value })} /></label>
      <div className="ws-form-grid"><label>{tr.status}<select value={draft.status} onChange={(e) => patch({ status: e.target.value as TaskStatus })}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{tr[s]}</option>)}</select></label>
        <label>{tr.priority}<select value={draft.priority} onChange={(e) => patch({ priority: e.target.value as Priority })}>{(['low', 'medium', 'high'] as const).map((p) => <option key={p} value={p}>{tr[p]}</option>)}</select></label>
        <label>{tr.dueDate}<input type="date" value={draft.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} /></label>
        <label>{tr.sprint}<select value={draft.sprintId ?? ''} onChange={(e) => patch({ sprintId: e.target.value || null })}><option value="">{tr.noSprint}</option>{Object.values(sprints).filter((s) => s.projectId === projectId && (s.status !== 'completed' || s.id === task?.sprintId)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'completed' ? ` · ${tr.sprintCompleted}` : ''}</option>)}</select></label>
      </div>
      {task?.sourceNodeId && <button type="button" className="ws-text-button" onClick={() => onSource(task)}><Icon name="planner" />{tr.sourcePlan}</button>}
      <div className="ws-form-actions">{task && <button type="button" className="ws-button danger ws-push-left" onClick={() => {
        useWorkspaceStore.getState().deleteTask(task.id); toast.show(tr.taskDeleted); onClose();
      }}><Icon name="trash" />{tr.delete}</button>}<button type="button" className="ws-button" onClick={onClose}>{tr.cancel}</button><button className="ws-button primary" disabled={!draft.title.trim()}>{task ? tr.save : tr.create}</button></div>
    </form>
    {task && <Comments key={task.id} taskId={task.id} />}
  </Modal>;
}
