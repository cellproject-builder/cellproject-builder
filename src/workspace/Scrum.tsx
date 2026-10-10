import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { useWorkspaceStore } from './store';
import type { Task, SprintInput } from './types';
import { Icon, Empty, attempt, shortDate } from './ui';
import { SprintTimeline } from './SprintTimeline';
import { PageHeader } from './PageHeader';

function SprintForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const tr = useT().workspace;
  const localISO = (offset: number) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [draft, setDraft] = useState<SprintInput>({ name: '', goal: '', startDate: localISO(0), endDate: localISO(14) });
  const patch = (value: Partial<SprintInput>) => setDraft((d) => ({ ...d, ...value }));
  return <Modal open onClose={onClose} title={tr.newSprint}><form className="ws-form" onSubmit={(e) => { e.preventDefault(); attempt(() => { useWorkspaceStore.getState().createSprint(projectId, draft); onClose(); }); }}>
    <label>{tr.sprintName}<input autoFocus required value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Sprint 1" /></label>
    <label>{tr.sprintGoal}<textarea rows={3} value={draft.goal} onChange={(e) => patch({ goal: e.target.value })} placeholder={tr.sprintGoalPlaceholder} /></label>
    <div className="ws-form-grid"><label>{tr.startDate}<input type="date" required value={draft.startDate} onChange={(e) => patch({ startDate: e.target.value })} /></label><label>{tr.endDate}<input type="date" required min={draft.startDate} value={draft.endDate} onChange={(e) => patch({ endDate: e.target.value })} /></label></div>
    <div className="ws-form-actions"><button type="button" className="ws-button" onClick={onClose}>{tr.cancel}</button><button className="ws-button primary" disabled={!draft.name.trim()}>{tr.create}</button></div>
  </form></Modal>;
}

export function Scrum({ projectId, onEdit, onAdd }: { projectId: string; onEdit: (task: Task) => void; onAdd: () => void }) {
  const tr = useT().workspace;
  const allSprints = useWorkspaceStore((s) => s.sprints);
  const allTasks = useWorkspaceStore((s) => s.tasks);
  const [creating, setCreating] = useState(false);
  const sprintCards = useRef<Record<string, HTMLElement | null>>({});
  const sprints = Object.values(allSprints).filter((s) => s.projectId === projectId).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const available = sprints.filter((s) => s.status !== 'completed');
  const tasks = Object.values(allTasks).filter((t) => t.projectId === projectId);
  const active = sprints.find((s) => s.status === 'active');
  const showSprint = (id: string) => {
    const card = sprintCards.current[id];
    if (!card) return;
    if (card instanceof HTMLDetailsElement) card.open = true;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    const target = card instanceof HTMLDetailsElement ? card.querySelector('summary') : card;
    target?.focus({ preventScroll: true });
  };
  const rows = (work: Task[], locked = false) => <div className="ws-task-rows">{work.map((task) => <div className="ws-task-row" key={task.id}>
    <span className={`ws-status-dot ${task.status}`} /><button onClick={() => onEdit(task)} className="ws-row-title">{task.title}</button><span className={`ws-priority ${task.priority}`}>{tr[task.priority]}</span>
    {!locked && <select className="ws-select" aria-label={`${tr.assignSprint}: ${task.title}`} value={task.sprintId ?? ''} onChange={(e) => attempt(() => useWorkspaceStore.getState().updateTask(task.id, { sprintId: e.target.value || null }))}><option value="">{tr.backlog}</option>{available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
  </div>)}</div>;
  return <div className="ws-page">
    <PageHeader title={tr.scrum} actions={<button className="ws-button primary" onClick={() => setCreating(true)}><Icon name="plus" />{tr.newSprint}</button>} />
    <SprintTimeline sprints={sprints} onSelect={showSprint} />
    <section className="ws-panel"><div className="ws-panel-heading"><h2>{tr.backlog}<span className="ws-count">{tasks.filter((t) => !t.sprintId).length}</span></h2><button className="ws-button small" onClick={onAdd}><Icon name="plus" size={15} />{tr.newTask}</button></div>
      {tasks.some((t) => !t.sprintId) ? rows(tasks.filter((t) => !t.sprintId)) : <p className="ws-inline-empty">{tr.noBacklogHint}</p>}
    </section>
    {!sprints.length && <Empty icon="scrum" title={tr.noSprints} hint={tr.noSprintsHint}><button className="ws-button" onClick={() => setCreating(true)}><Icon name="plus" />{tr.newSprint}</button></Empty>}
    {available.map((sprint) => {
      const work = tasks.filter((t) => t.sprintId === sprint.id), done = work.filter((t) => t.status === 'done').length;
      return <section className={`ws-panel ws-sprint ${sprint.status === 'active' ? 'is-active' : ''}`} key={sprint.id} ref={(card) => { sprintCards.current[sprint.id] = card; }} tabIndex={-1} aria-label={sprint.name}>
        <div className="ws-panel-heading"><div><div className="ws-sprint-title"><h2>{sprint.name}</h2><span className={`ws-badge ${sprint.status}`}>{sprint.status === 'active' ? tr.sprintActive : tr.planned}</span></div><p className="ws-date-range">{shortDate(sprint.startDate)} — {shortDate(sprint.endDate)} · {done}/{work.length} {tr.completed.toLocaleLowerCase()}</p></div>
          <button className={`ws-button ${sprint.status === 'active' ? '' : 'primary'}`} disabled={sprint.status !== 'active' && !!active} onClick={() => attempt(() => sprint.status === 'active' ? useWorkspaceStore.getState().completeSprint(sprint.id) : useWorkspaceStore.getState().startSprint(sprint.id))}>{sprint.status === 'active' ? tr.finishSprint : tr.startSprint}</button>
        </div>{sprint.goal && <p className="ws-sprint-goal">{sprint.goal}</p>}{work.length ? rows(work) : <p className="ws-inline-empty">{tr.noSprintsHint}</p>}{sprint.status === 'active' && <p className="ws-sprint-footnote">{tr.finishHint}</p>}
      </section>;
    })}
    {sprints.some((s) => s.status === 'completed') && <div className="ws-history"><h2>{tr.sprintHistory}</h2>{sprints.filter((s) => s.status === 'completed').reverse().map((sprint) => <details className="ws-panel" key={sprint.id} ref={(card) => { sprintCards.current[sprint.id] = card; }}><summary>{sprint.name}<span>{tr.sprintCompleted} · {shortDate(sprint.endDate)}</span></summary>{rows(tasks.filter((t) => t.sprintId === sprint.id), true)}</details>)}</div>}
    {creating && <SprintForm projectId={projectId} onClose={() => setCreating(false)} />}
  </div>;
}
