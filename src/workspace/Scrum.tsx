import { AudioTextarea, AudioTextInput } from '@/audio/AudioField';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/ui/SoftIcons';
import { useWorkspaceStore } from './store';
import { TASK_STATUSES, type Task, type SprintInput } from './types';
import { Icon, Empty, attempt, shortDate } from './ui';
import { SprintTimeline } from './SprintTimeline';
import { ExecutionHeader } from './ExecutionHeader';
import { TaskRow } from './TaskRow';
import { StatusIcon } from './TaskPresentation';
import { writeTaskViewPreference } from './taskViewPreference';
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
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; history: boolean } | null>(null);
  const sprintPanel = useRef<HTMLElement>(null);
  const sprintCards = useRef<Record<string, HTMLElement | null>>({});
  const sprints = Object.values(allSprints).filter((s) => s.projectId === projectId).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const available = sprints.filter((s) => s.status !== 'completed');
  const completed = sprints.filter((s) => s.status === 'completed').reverse();
  const tasks = Object.values(allTasks).filter((t) => t.projectId === projectId);
  const backlog = tasks.filter((t) => !t.sprintId);
  const active = sprints.find((s) => s.status === 'active');
  const selected = sprints.find((s) => s.id === selectedSprintId) ?? active ?? available[0] ?? completed[0];
  const selectedIndex = sprints.findIndex((s) => s.id === selected?.id);
  const previous = sprints[selectedIndex - 1];
  const next = sprints[selectedIndex + 1];
  const selectedWork = tasks.filter((task) => task.sprintId === selected?.id);
  const done = selectedWork.filter((task) => task.status === 'done').length;
  const commentCounts = useMemo(() => Object.values(comments).reduce<Record<string, number>>((counts, comment) => {
    counts[comment.taskId] = (counts[comment.taskId] ?? 0) + 1;
    return counts;
  }, {}), [comments]);
  useEffect(() => {
    if (!focusRequest) return;
    const card = focusRequest.history ? sprintCards.current[focusRequest.id] : sprintPanel.current;
    if (!card) return;
    if (card instanceof HTMLDetailsElement) card.open = true;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    const target = card instanceof HTMLDetailsElement ? card.querySelector('summary') : card;
    target?.focus({ preventScroll: true });
  }, [focusRequest]);
  const showSprint = (id: string, fromTimeline = false) => {
    const sprint = sprints.find((s) => s.id === id);
    if (!sprint) return;
    setSelectedSprintId(id);
    setFocusRequest({ id, history: fromTimeline && sprint.status === 'completed' });
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
    <ExecutionHeader title={tr.scrum} view="scrum" onViewChange={(view) => {
      if (view === 'scrum') return;
      writeTaskViewPreference(view);
      useWorkspaceStore.getState().navigate('kanban');
    }} actions={<button className="ws-button primary" aria-label={tr.newSprint} onClick={() => setCreating(true)}><Icon name="plus" />{tr.newSprint}</button>} />
    <div className="ws-execution-scroll ws-scrum-body" role="region" aria-label={tr.scrum} tabIndex={0}>
      {selected ? <section className={`ws-sprint-focus ${selected.status === 'active' ? 'is-active' : ''}`} ref={sprintPanel} tabIndex={-1} aria-labelledby={`${headingId}-focus`}>
        <div className="ws-sprint-focus-head">
          <div className="ws-sprint-heading"><div className="ws-sprint-title"><h2 id={`${headingId}-focus`}>{selected.name}</h2><span className={`ws-badge ${selected.status}`}>{selected.status === 'active' ? tr.sprintActive : selected.status === 'completed' ? tr.sprintCompleted : tr.planned}</span></div><p className="ws-date-range"><time dateTime={selected.startDate}>{shortDate(selected.startDate)}</time> — <time dateTime={selected.endDate}>{shortDate(selected.endDate)}</time></p></div>
          <nav className="ws-sprint-navigation" aria-label={tr.scrum}>
            <button className="ws-icon-button" aria-label={tr.previousSprint} disabled={!previous} onClick={() => previous && showSprint(previous.id)}><ArrowLeftIcon aria-hidden="true" /></button>
            <select className="ws-select ws-sprint-picker" aria-label={tr.sprint} value={selected.id} onChange={(event) => showSprint(event.target.value)}>{sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}</select>
            <button className="ws-icon-button" aria-label={tr.nextSprint} disabled={!next} onClick={() => next && showSprint(next.id)}><ArrowRightIcon aria-hidden="true" /></button>
            {active && active.id !== selected.id && <button className="ws-text-button ws-sprint-active-link" aria-label={tr.activeSprint} onClick={() => showSprint(active.id)}>{tr.activeSprint}</button>}
          </nav>
          {selected.status !== 'completed' && <button className={`ws-button ws-sprint-cycle-action ${selected.status === 'active' ? '' : 'primary'}`} disabled={selected.status !== 'active' && !!active} onClick={() => attempt(() => selected.status === 'active' ? useWorkspaceStore.getState().completeSprint(selected.id) : useWorkspaceStore.getState().startSprint(selected.id))}>{selected.status === 'active' ? tr.finishSprint : tr.startSprint}</button>}
        </div>
        {selected.goal && <p className="ws-sprint-goal">{selected.goal}</p>}
        <div className="ws-sprint-focus-grid">
          <div className="ws-sprint-progress"><h3>{tr.progress}</h3><p><strong>{done}</strong><span>/ {selectedWork.length} {tr.completed.toLocaleLowerCase()}</span></p><progress value={done} max={selectedWork.length || 1} aria-label={`${selected.name}: ${tr.completed}`} aria-valuetext={`${done}/${selectedWork.length} ${tr.completed.toLocaleLowerCase()}`} /></div>
          <div className="ws-sprint-status-block"><h3>{tr.status}</h3><dl className="ws-sprint-statuses">{TASK_STATUSES.map((status) => <div key={status}><dt><StatusIcon status={status} />{tr[status]}</dt><dd>{selectedWork.filter((task) => task.status === status).length}</dd></div>)}</dl></div>
        </div>
        {selected.status === 'active' && <p className="ws-sprint-footnote">{tr.finishHint}</p>}
      </section> : <Empty icon="scrum" title={tr.noSprints} hint={tr.noSprintsHint}><button className="ws-button" onClick={() => setCreating(true)}><Icon name="plus" />{tr.newSprint}</button></Empty>}
      <SprintTimeline sprints={sprints} onSelect={(id) => showSprint(id, true)} />
      {selected && <section className="ws-scrum-collection" aria-labelledby={`${headingId}-tasks`}><div className="ws-panel-heading"><h2 id={`${headingId}-tasks`}>{tr.tasks}<span className="ws-count">{selectedWork.length}</span></h2><span className="ws-scrum-collection-scope" title={selected.name}>{selected.name}</span></div>{selectedWork.length ? rows(selectedWork, selected.status === 'completed') : <p className="ws-inline-empty">{tr.emptyColumn}</p>}</section>}
      <section className="ws-scrum-collection ws-scrum-backlog" aria-labelledby={`${headingId}-backlog`}><div className="ws-panel-heading"><h2 id={`${headingId}-backlog`}>{tr.backlog}<span className="ws-count">{backlog.length}</span></h2><button className="ws-button small" onClick={onAdd}><Icon name="plus" size={15} />{tr.newTask}</button></div>{backlog.length ? rows(backlog) : <p className="ws-inline-empty">{tr.noBacklogHint}</p>}</section>
      {completed.length > 0 && <section className="ws-history" aria-labelledby={`${headingId}-history`}><h2 id={`${headingId}-history`}>{tr.sprintHistory}<span className="ws-count">{completed.length}</span></h2>{completed.map((sprint) => {
        const work = tasks.filter((t) => t.sprintId === sprint.id);
        return <details className="ws-scrum-collection" key={sprint.id} ref={(card) => { sprintCards.current[sprint.id] = card; }}><summary><span className="ws-sprint-history-name">{sprint.name}<span className="ws-count">{work.length}</span></span><span className="ws-sprint-history-meta">{tr.sprintCompleted} · <time dateTime={sprint.endDate}>{shortDate(sprint.endDate)}</time></span></summary>{rows(work, true)}</details>;
      })}</section>}
    </div>
    {creating && <SprintForm projectId={projectId} onClose={() => setCreating(false)} />}
  </div>;
}
