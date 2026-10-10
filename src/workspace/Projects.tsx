import { useState } from 'react';
import { useT, useLocaleStore } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { useWorkspaceStore } from './store';
import type { ManagedProject } from './types';
import { Empty, Icon, attempt, shortDate } from './ui';
import { toast } from '@/components/ui/Toast';
import { loadWorkspaceDemo } from './demoData';
import { PageHeader } from './PageHeader';
import { openPlanner, plannerBusy } from './planner';
import { projectEvidenceProgress, projectProgress, useGraphStore } from '@/store';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { AsciiWorkshop } from './AsciiWorkshop';

function enterPlan(projectId: string) {
  openPlanner(projectId);
  const store = useWorkspaceStore.getState();
  store.selectProject(projectId);
  store.navigate('planner');
}

export function ProjectForm({ project, initialObjective = '', initialRules = [], onClose }: { project?: ManagedProject; initialObjective?: string; initialRules?: string[]; onClose: () => void }) {
  const tr = useT().workspace;
  const [name, setName] = useState(project?.name ?? '');
  const [objective, setObjective] = useState(project?.objective ?? initialObjective);
  return <Modal open onClose={onClose} title={project ? tr.editProject : tr.newProject}>
    <form className="ws-form" onSubmit={(e) => { e.preventDefault(); attempt(() => {
      const store = useWorkspaceStore.getState();
      if (project) store.updateProject(project.id, { name, objective });
      else {
        if (!objective.trim()) return;
        if (plannerBusy()) throw new Error('plannerBusy');
        const id = store.createProject(name.trim() || objective.trim().slice(0, 80), objective);
        enterPlan(id);
        if (initialRules.length) useGraphStore.getState().setObjectiveDraft({ rules: [...initialRules] });
      }
      onClose();
    }); }}>
      {!project && <p className="ws-form-intro">{initialRules.length ? tr.research.draftHint : tr.projectsHint}</p>}
      <label>{tr.objective}<textarea autoFocus={!project} required={!project} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={tr.objectivePlaceholder} rows={4} /></label>
      {!project && initialRules.length > 0 && <section className="ws-study-rules" aria-label={tr.research.rulesLabel}><h3>{tr.research.rulesLabel}</h3><ul>{initialRules.map((rule) => <li key={rule}>{rule}</li>)}</ul><p>{tr.research.rulesHint}</p></section>}
      <label>{project ? tr.projectName : tr.optionalProjectName}<input autoFocus={Boolean(project)} required={Boolean(project)} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr.namePlaceholder} maxLength={160} /></label>
      <div className="ws-form-actions">{project && <button type="button" className="ws-button ws-push-left" onClick={() => { useWorkspaceStore.getState().updateProject(project.id, { archived: !project.archived }); onClose(); }}>{project.archived ? tr.unarchive : tr.archive}</button>}<button type="button" className="ws-button" onClick={onClose}>{tr.cancel}</button><button className="ws-button primary" disabled={project ? !name.trim() : !objective.trim()}>{project ? tr.save : tr.continueToPlan}</button></div>
    </form>
  </Modal>;
}

export function Projects() {
  const tr = useT().workspace;
  const english = useLocaleStore((s) => s.locale === 'en');
  const projects = useWorkspaceStore((s) => s.projects);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState<{ objective: string; rules?: string[] } | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [starterInterest, setStarterInterest] = useState<number | null>(null);
  const loadDemo = async () => {
    if (loadingDemo) return;
    setLoadingDemo(true);
    try {
      const result = await loadWorkspaceDemo();
      if (result.projectIds[0]) enterPlan(result.projectIds[0]);
      toast.show({ message: result.createdProjects ? (english ? 'Demo projects, tasks and notes are ready.' : 'Projetos, tarefas e notas de demonstração prontos.') : (english ? 'The demo is already loaded. Your edits were preserved.' : 'A demonstração já está carregada. Suas edições foram preservadas.'), tone: 'ok' });
    } catch {
      toast.show({ message: english ? 'Could not save the demo data. Check local storage and try again.' : 'Não foi possível salvar a demonstração. Verifique o armazenamento local e tente novamente.', tone: 'warn' });
    } finally { setLoadingDemo(false); }
  };
  const all = Object.values(projects).filter((p) => p.archived === archived);
  const visible = all.filter((p) => `${p.name} ${p.objective}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  return <div className="ws-page">
    <PageHeader title={tr.myProjects}
      controls={<>
        <div className="ws-segmented">
          <button aria-pressed={!archived} className={!archived ? 'selected' : ''} onClick={() => setArchived(false)}>{tr.active}</button>
          <button aria-pressed={archived} className={archived ? 'selected' : ''} onClick={() => setArchived(true)}>{tr.archived}</button>
        </div>
        <label className="ws-search"><Icon name="search" /><input aria-label={tr.searchProjects} placeholder={tr.searchProjects} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button className="ws-button ws-demo-action" disabled={loadingDemo} onClick={() => void loadDemo()}>{loadingDemo ? (english ? 'Loading demo…' : 'Carregando demonstração…') : (english ? 'Load demo' : 'Carregar demonstração')}</button>
      </>}
      actions={<button className="ws-button primary" onClick={() => setCreating({ objective: '' })}><Icon name="plus" />{tr.newProject}</button>}
    />
    {!archived && !query && <section className="ws-start-panel" aria-labelledby="start-plan-title">
      <div><p className="ws-eyebrow">{tr.planner}</p><h2 id="start-plan-title">{tr.greeting}</h2><p className="ws-subtitle">{tr.projectsHint}</p></div>
      <div className="ws-start-examples">{tr.starterExamples.map((example, index) => <button key={example.label} onPointerEnter={() => setStarterInterest(index)} onPointerLeave={() => setStarterInterest(null)} onFocus={() => setStarterInterest(index)} onBlur={() => setStarterInterest(null)} onClick={() => setCreating({ objective: example.objective })}><Icon name="planner" size={16} /><span>{example.label}</span><Icon name="arrow" size={14} /></button>)}</div>
      <AsciiWorkshop interest={starterInterest} />
    </section>}
    {!archived && !query && <section className="ws-research-panel" aria-labelledby="research-objective-title">
      <div className="ws-research-heading"><div><p className="ws-eyebrow">{tr.research.kicker}</p><h2 id="research-objective-title">{tr.research.title}</h2></div><button className="ws-button" onClick={() => setCreating({ objective: tr.research.studyObjective, rules: tr.research.studyRules })}>{tr.research.start}</button></div>
      <p className="ws-research-objective">{tr.research.objective}</p>
      <ol className="ws-research-cycle" aria-label={tr.research.cycleLabel}>{tr.research.steps.map((step, index) => <li key={step}><span aria-hidden>{index + 1}</span>{step}</li>)}</ol>
      <details className="ws-research-question"><summary>{tr.research.questionLabel}</summary><p>{tr.research.question}</p></details>
      <p className="ws-research-case">{tr.research.caseLabel}</p>
    </section>}
    {visible.length ? <div className="ws-project-grid">{visible.map((project, index) => {
      const progress = projectProgress(project.planner?.project ?? null);
      const evidence = projectEvidenceProgress(project.planner?.project ?? null);
      return <button className="ws-project-card" key={project.id} onClick={() => attempt(() => enterPlan(project.id))}>
        <div className="ws-card-top"><span className={`ws-project-symbol color-${index % 4}`}><Icon name="planner" size={22} /></span><Icon name="arrow" size={16} /></div>
        <h2>{project.name}</h2><p>{project.objective || tr.planHint}</p>
        <div className="ws-card-plan-status">{progress.total > 0 ? <><span aria-hidden><ProgressRing total={progress.total} done={progress.done} withProof={evidence.withEvidence} /></span><span>{tr.resolvedParts(progress.done, progress.total)}</span></> : <span>{tr.draftPlan}</span>}</div>
        <div className="ws-card-meta"><span>{tr.evidenceCount(evidence.withEvidence)}{evidence.assumedKnown > 0 && ` · ${tr.knownCount(evidence.assumedKnown)}`}</span><span>{shortDate(project.updatedAt)}</span></div>
      </button>;
    })}</div> : <Empty title={all.length || query ? tr.noResults : tr.noProjects} hint={all.length || query ? tr.noResultsHint : tr.noProjectsHint}>
      {!archived && <button className="ws-button primary" onClick={() => setCreating({ objective: '' })}><Icon name="plus" />{tr.newProject}</button>}
    </Empty>}
    {creating !== null && <ProjectForm initialObjective={creating.objective} initialRules={creating.rules} onClose={() => setCreating(null)} />}
  </div>;
}
