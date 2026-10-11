import { AudioTextarea, AudioTextInput } from '@/audio/AudioField';
import { useId, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { useWorkspaceStore } from './store';
import type { Task, SprintInput } from './types';
import { Icon, Empty, attempt, shortDate } from './ui';
import { SprintTimeline } from './SprintTimeline';
import { PageHeader } from './PageHeader';
import { TaskRow } from './TaskRow';
import './Board.css';
import './Scrum.css';

function SprintForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const tr = useT().workspace;
  const localISO = (offset: number) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [draft, setDraft] = useState<SprintInput>({ name: '', goal: '', startDate: localISO(0), endDate: localISO(14) });
  const patch = (value: Partial<SprintInput>) => setDraft((d) => ({ ...d, ...value }));
  return <Modal open onClose={onClose} title={tr.newSprint}><form className="ws-form" onSubmit={(e) => { e.preventDefault(); attempt(() => { useWorkspaceStore.getState().createSprint(projectId, draft); onClose(); }); }}>
    <label>{tr.sprintName}<AudioTextInput audioScope={`project:${projectId}:new-sprint:name`} autoFocus required value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Sprint 1" /></label>
    <label>{tr.sprintGoal}<AudioTextarea audioScope={`project:${projectId}:new-sprint:goal`} rows={3} value={draft.goal} onChange={(e) => patch({ goal: e.target.value })} placeholder={tr.sprintGoalPlaceholder} /></label>
    <div className="ws-form-grid"><label>{tr.startDate}<input type="date" required value={draft.startDate} onChange={(e) => patch({ startDate: e.target.value })} /></label><label>{tr.endDate}<input type="date" required min={draft.startDate} value={draft.endDate} onChange={(e) => patch({ endDate: e.target.value })} /></label></div>
    <div className="ws-form-actions"><button type="button" className="ws-button" onClick={onClose}>{tr.cancel}</button><button className="ws-button primary" disabled={!draft.name.trim()}>{tr.create}</button></div>
  </form></Modal>;
}

export function Scrum({ projectId, onEdit, onAdd }: { projectId: string; onEdit: (task: Task) => void; onAdd: () => void }) {
  const tr = useT().workspace;
  const allSprints = useWorkspaceStore((s) => s.sprints);
  const allTasks = useWorkspaceStore((s) => s.tasks);
  const comments = useWorkspaceStore((s) => s.comments);
  const headingId = useId();
  const [creating, setCreating] = useState(false);
  const sprintCards = useRef<Record<string, HTMLElement | null>>({});
  const sprints = Object.values(allSprints).filter((s) => s.projectId === projectId).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const available = sprints.filter((s) => s.status !== 'completed');
  const completed = sprints.filter((s) => s.status === 'completed').reverse();
  const tasks = Object.values(allTasks).filter((t) => t.projectId === projectId);
  const backlog = tasks.filter((t) => !t.sprintId);
  const active = sprints.find((s) => s.status === 'active');
  const commentCounts = useMemo(() => Object.values(comments).reduce<Record<string, number>>((counts, comment) => {
    counts[comment.taskId] = (counts[comment.taskId] ?? 0) + 1;
    return counts;
  }, {}), [comments]);
  const showSprint = (id: string) => {
    const card = sprintCards.current[id];
    if (!card) return;
    if (card instanceof HTMLDetailsElement) card.open = true;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    const target = card instanceof HTMLDetailsElement ? card.querySelector('summary') : card;
    target?.focus({ preventScroll: true });
  };
  const rows = (work: Task[], locked = false) => <div className="ws-scrum-tasks">{work.map((task) => <TaskRow
    key={task.id}
    task={task}
    onEdit={onEdit}
    commentCount={commentCounts[task.id] ?? 0}
    readOnlyStatus={locked}
    trailing={!locked && <select className="ws-select ws-sprint-assignment" aria-label={`${tr.assignSprint}: ${task.title}`} value={task.sprintId ?? ''} onChange={(e) => attempt(() => useWorkspaceStore.getState().updateTask(task.id, { sprintId: e.target.value || null }))}><option value="">{tr.backlog}</option>{available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
  />)}</div>;
  return <div className="ws-page ws-scrum-page ws-execution-page">
    <PageHeader title={tr.scrum} actions={<button className="ws-button primary" onClick={() => setCreating(true)}><Icon name="plus" />{tr.newSprint}</button>} />
    <SprintTimeline sprints={sprints} onSelect={showSprint} />
    <section className="ws-panel ws-scrum-backlog" aria-labelledby={`${headingId}-backlog`}><div className="ws-panel-heading"><h2 id={`${headingId}-backlog`}>{tr.backlog}<span className="ws-count">{backlog.length}</span></h2><button className="ws-button small" onClick={onAdd}><Icon name="plus" size={15} />{tr.newTask}</button></div>
      {backlog.length ? rows(backlog) : <p className="ws-inline-empty">{tr.noBacklogHint}</p>}
    </section>
    {!sprints.length && <Empty icon="scrum" title={tr.noSprints} hint={tr.noSprintsHint}><button className="ws-button" onClick={() => setCreating(true)}><Icon name="plus" />{tr.newSprint}</button></Empty>}
    {available.map((sprint) => {
      const work = tasks.filter((t) => t.sprintId === sprint.id), done = work.filter((t) => t.status === 'done').length;
      return <section className={`ws-panel ws-sprint ${sprint.status === 'active' ? 'is-active' : ''}`} key={sprint.id} ref={(card) => { sprintCards.current[sprint.id] = card; }} tabIndex={-1} aria-label={sprint.name}>
        <div className="ws-panel-heading"><div className="ws-sprint-heading"><div className="ws-sprint-title"><h2>{sprint.name}<span className="ws-count">{work.length}</span></h2><span className={`ws-badge ${sprint.status}`}>{sprint.status === 'active' ? tr.sprintActive : tr.planned}</span></div><p className="ws-date-range"><time dateTime={sprint.startDate}>{shortDate(sprint.startDate)}</time> — <time dateTime={sprint.endDate}>{shortDate(sprint.endDate)}</time></p></div>
          <button className={`ws-button ${sprint.status === 'active' ? '' : 'primary'}`} disabled={sprint.status !== 'active' && !!active} onClick={() => attempt(() => sprint.status === 'active' ? useWorkspaceStore.getState().completeSprint(sprint.id) : useWorkspaceStore.getState().startSprint(sprint.id))}>{sprint.status === 'active' ? tr.finishSprint : tr.startSprint}</button>
        </div>
        {sprint.goal && <p className="ws-sprint-goal">{sprint.goal}</p>}
        <div className="ws-sprint-progress"><span>{done}/{work.length} {tr.completed.toLocaleLowerCase()}</span><progress value={done} max={work.length || 1} aria-label={`${sprint.name}: ${tr.completed}`} aria-valuetext={`${done}/${work.length} ${tr.completed.toLocaleLowerCase()}`} /></div>
        {work.length ? rows(work) : <p className="ws-inline-empty">{tr.noSprintsHint}</p>}
        {sprint.status === 'active' && <p className="ws-sprint-footnote">{tr.finishHint}</p>}
      </section>;
    })}
    {completed.length > 0 && <section className="ws-history" aria-labelledby={`${headingId}-history`}><h2 id={`${headingId}-history`}>{tr.sprintHistory}<span className="ws-count">{completed.length}</span></h2>{completed.map((sprint) => {
      const work = tasks.filter((t) => t.sprintId === sprint.id);
      return <details className="ws-panel" key={sprint.id} ref={(card) => { sprintCards.current[sprint.id] = card; }}><summary><span className="ws-sprint-history-name">{sprint.name}<span className="ws-count">{work.length}</span></span><span className="ws-sprint-history-meta">{tr.sprintCompleted} · <time dateTime={sprint.endDate}>{shortDate(sprint.endDate)}</time></span></summary>{rows(work, true)}</details>;
    })}</section>}
    {creating && <SprintForm projectId={projectId} onClose={() => setCreating(false)} />}
  </div>;
}
