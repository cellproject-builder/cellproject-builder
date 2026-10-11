import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { GearIcon, DashboardIcon, ChatBubbleIcon } from '@/components/ui/SoftIcons';
import { useT, useLocaleStore } from '@/i18n';
import { PRODUCT_NAME } from '@/brand';
import { useThemeStore, type Theme } from '@/theme';
import { AssistantChat } from '@/chat/AssistantChat';
import { AssistantChatDockProvider, FullChatDock } from '@/chat/AssistantChatDock';
import { useChatPresentation } from '@/chat/presentation';
import { useChatStore } from '@/chat/store';
import { useUIRequests } from './uiRequests';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ApiKeyGate } from '@/components/ApiKeyGate';
import { InstallApp } from '@/pwa/InstallApp';
import { CloudDataControls } from '@/cloud/CloudStatus';
import { isCloudEnabled } from '@/cloud/runtime';
import { toast } from '@/components/ui/Toast';
import { projectEvidenceProgress, projectProgress, useGraphStore } from '@/store';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { useWorkspaceStore } from './store';
import { useSidebarStore } from './sidebarPreference';
import { connectPlanner, initializeWorkspace, openPlanner } from './planner';
import { Projects, ProjectForm } from './Projects';
import { Board } from './Board';
import { Scrum } from './Scrum';
import { Notes } from './Notes';
import { TaskEditor } from './TaskEditor';
import type { ManagedProject, Surface, Task, TaskStatus } from './types';
import { Empty, Icon, attempt } from './ui';
import { PageHeader, PageHeaderContext } from './PageHeader';
import { ProjectIcon } from './project-appearance/projectIcons';
import { ProjectDescription } from './ProjectDescription';
import './design-system.css';
import './workspace.css';
import './PageHeader.css';
import './mobile.css';

const DynamicBoards = lazy(() => import('@/boards/DynamicBoards').then(module => ({ default: module.DynamicBoards })));

function Overview({ project, onAdd, onPlan, onNotes, onEditProject }: { project: ManagedProject; onAdd: () => void; onPlan: () => void; onNotes: (id?: string) => void; onEditProject: () => void }) {
  const tr = useT().workspace;
  const taskRecord = useWorkspaceStore((s) => s.tasks);
  const noteRecord = useWorkspaceStore((s) => s.notes);
  const sprintRecord = useWorkspaceStore((s) => s.sprints);
  const navigate = useWorkspaceStore((s) => s.navigate);
  const tasks = Object.values(taskRecord).filter((t) => t.projectId === project.id);
  const notes = Object.values(noteRecord).filter((n) => n.projectId === project.id && !n.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  const done = tasks.filter((t) => t.status === 'done').length;
  const activeSprint = Object.values(sprintRecord).find((s) => s.projectId === project.id && s.status === 'active');
  const progress = projectProgress(project.planner?.project ?? null);
  const evidence = projectEvidenceProgress(project.planner?.project ?? null);
  return <div className="ws-page">
    <PageHeader title={project.name} titleIcon={<ProjectIcon appearance={project.appearance} size={20}/>} actions={<button className="ws-button" onClick={onEditProject}><Icon name="edit" size={16} />{tr.edit}</button>} />
    <ProjectDescription key={project.id} text={project.objective}/>
    <section className="ws-panel ws-plan-focus">
      <div className="ws-plan-intro"><div className="ws-plan-icon"><Icon name="planner" size={25} /></div><h2>{tr.planner}</h2><p>{tr.planHint}</p><button className="ws-button primary" onClick={onPlan}>{project.planner?.project ? tr.continuePlan : tr.buildPlan}<Icon name="arrow" size={15} /></button></div>
      <div className="ws-plan-summary"><h3>{tr.planProgress}</h3>{progress.total > 0 ? <><div className="ws-plan-count"><span aria-hidden><ProgressRing total={progress.total} done={progress.done} withProof={evidence.withEvidence} size={32} /></span><strong>{tr.resolvedParts(progress.done, progress.total)}</strong></div><p>{tr.evidenceCount(evidence.withEvidence)} · {tr.knownCount(evidence.assumedKnown)}</p></> : <p>{tr.draftPlan}</p>}<small>{tr.planProgressHint}</small></div>
    </section>
    <h2 className="ws-support-heading">{tr.supportTools}</h2>
    <div className="ws-stats">{[
      [tasks.length, tr.tasks, 'kanban'], [tasks.filter((t) => t.status === 'doing').length, tr.inProgress, 'kanban'], [done, tr.completed, 'kanban'], [notes.length, tr.linkedNotes, 'notes'],
    ].map(([value, label, view]) => <button className="ws-stat" key={label} onClick={() => view === 'notes' ? onNotes() : navigate('kanban')}><strong>{value}</strong><span>{label}</span></button>)}</div>
    <div className="ws-overview-grid"><section className="ws-panel"><div className="ws-panel-heading"><h2>{tr.nextTasks}</h2><button className="ws-button small" onClick={onAdd}><Icon name="plus" size={15} />{tr.newTask}</button></div>
      {tasks.some((t) => t.status !== 'done') ? <div className="ws-task-rows">{tasks.filter((t) => t.status !== 'done').slice(0, 5).map((task) => <button key={task.id} className="ws-task-row" onClick={() => navigate('kanban')}><span className={`ws-status-dot ${task.status}`} /><span className="ws-row-title">{task.title}</span><span className={`ws-priority ${task.priority}`}>{tr[task.priority]}</span></button>)}</div> : <Empty icon="kanban" title={tr.noTasks} hint={tr.noTasksHint} />}
      <div className="ws-panel-footer"><button className="ws-text-button" onClick={() => navigate('kanban')}>{tr.openBoard}<Icon name="arrow" size={15} /></button></div>
    </section><section className="ws-panel ws-plan-card"><div className="ws-plan-icon"><Icon name="kanban" size={25} /></div><h2>{tr.tasks}</h2><p>{tr.noTasksHint}</p><button className="ws-button" onClick={() => navigate('kanban')}>{tr.openBoard}<Icon name="arrow" size={15} /></button>{project.planner?.project && <button className="ws-text-button" onClick={() => toast.show(tr.importedTasks(useWorkspaceStore.getState().importPlanTasks(project.id)))}>{tr.importTasks}</button>}</section></div>
    <div className="ws-overview-grid"><section className="ws-panel"><div className="ws-panel-heading"><h2>{tr.recentNotes}</h2><button className="ws-text-button" onClick={() => onNotes()}>{tr.openNotes}<Icon name="arrow" size={14} /></button></div>{notes.length ? <div className="ws-recent-notes">{notes.slice(0, 3).map((note) => <button key={note.id} onClick={() => onNotes(note.id)}><Icon name="notes" /><span><strong>{note.title || tr.untitled}</strong><small>{note.blocks.find((b) => b.text.trim())?.text || tr.notePlaceholder}</small></span>{note.pinned && <Icon name="pin" size={14} />}</button>)}</div> : <p className="ws-inline-empty">{tr.noNotesHint}</p>}</section>
      <section className="ws-panel ws-progress-panel"><h2>{tr.progress}</h2><div><strong>{tasks.length ? Math.round(done / tasks.length * 100) : 0}<span>%</span></strong><p>{done}/{tasks.length} {tr.completed.toLocaleLowerCase()}</p></div><div className="ws-project-progress"><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div>{activeSprint && <button className="ws-text-button" onClick={() => navigate('scrum')}><Icon name="scrum" size={16} />{activeSprint.name}</button>}</section>
    </div>
  </div>;
}

export function Workspace({ planner, canvasMaximized = false }: { planner: ReactNode; canvasMaximized?: boolean }) {
  const tr = useT().workspace;
  const theme = useThemeStore((s) => s.theme);
  const english = useLocaleStore((s) => s.locale) === 'en';
  const setTheme = useThemeStore((s) => s.setTheme);
  const sideCollapsed = useSidebarStore((s) => s.collapsed);
  const toggleSideCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const uiRequest = useUIRequests((s) => s.request);
  const projects = useWorkspaceStore((s) => s.projects);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const surface = useWorkspaceStore((s) => s.surface);
  const chatExpanded = useChatPresentation(s => s.expanded);
  const chatOpen = useChatStore(s => s.open);
  const collapseChat = () => useChatPresentation.getState().setExpanded(false);
  const navigate = useWorkspaceStore((s) => s.navigate);
  const [noteScope, setNoteScope] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [boardMaximized, setBoardMaximized] = useState(false);
  const [noteMaximized, setNoteMaximized] = useState(false);
  const [taskEditor, setTaskEditor] = useState<{ task?: Task; status?: TaskStatus } | null>(null);
  const project = activeProjectId ? projects[activeProjectId] : undefined;
  useEffect(() => { initializeWorkspace(); return connectPlanner(); }, []);
  useEffect(() => { setSideOpen(false); setTaskEditor(null); collapseChat(); }, [surface, activeProjectId]);
  useEffect(() => {
    if (!uiRequest) return;
    if (uiRequest.settings) setSettings(true);
    if (uiRequest.surface === 'notes') { setNoteScope(uiRequest.projectId ?? null); setNoteId(uiRequest.noteId ?? null); }
    if (uiRequest.taskId) {
      const task = useWorkspaceStore.getState().tasks[uiRequest.taskId];
      if (task) setTaskEditor({ task });
    }
    setSideOpen(false);
  }, [uiRequest]);
  const go = (view: Surface) => {
    collapseChat();
    attempt(() => {
      if (view === 'planner' && project) openPlanner(project.id);
      if (view === 'notes') { setNoteScope(project?.id ?? null); setNoteId(null); }
      navigate(view); setSideOpen(false);
    });
  };
  const openNotes = (id?: string) => { setNoteScope(project?.id ?? null); setNoteId(id ?? null); navigate('notes'); };
  const source = (task: Task) => attempt(() => {
    openPlanner(task.projectId);
    const graph = useGraphStore.getState();
    if (!graph.project || graph.project.id !== task.sourcePlanId || !task.sourceNodeId || !graph.project.nodes[task.sourceNodeId]) throw new Error('invalidTask');
    graph.setViewMode('graph'); graph.selectNode(task.sourceNodeId); graph.requestCenter(task.sourceNodeId);
    navigate('planner'); setTaskEditor(null);
  });
  const navItem = (view: 'overview' | 'kanban' | 'scrum' | 'notes' | 'planner') => <button key={view} className={`ws-nav-item ${!chatExpanded && surface === view && (view !== 'notes' || noteScope === project?.id) ? 'selected' : ''}`} aria-label={tr[view]} title={`${project?.name} · ${tr[view]}`} onClick={() => go(view)}><Icon name={view} /><span>{tr[view]}</span></button>;
  const mobileMenu = <button className="ws-icon-button ws-mobile-menu" aria-label={tr.navigation} aria-expanded={sideOpen} aria-controls="workspace-sidebar" onClick={() => setSideOpen(!sideOpen)}><Icon name="menu" /></button>;
  const headerShell = {
    navigation: mobileMenu,
    breadcrumb: project && surface !== 'projects' && surface !== 'boards' ? <><button onClick={() => navigate('projects')}>{tr.projects}</button><span>/</span>{surface !== 'overview' && <><button className="ws-project-identity" title={project.name} onClick={() => go('overview')}><ProjectIcon appearance={project.appearance} size={14}/><span>{project.name}</span></button><span>/</span></>}</> : null,
    status: project?.archived && surface !== 'projects' && surface !== 'boards' ? <span className="ws-badge">{tr.archived}</span> : null,
  };
  return <AssistantChatDockProvider><div className={`ws-app ${surface === 'notes' ? 'notes-surface' : ''} ${canvasMaximized && !chatExpanded ? 'is-canvas-maximized' : ''} ${chatExpanded ? 'is-chat-expanded' : ''}`}>
    {sideOpen && <button className="ws-sidebar-scrim" aria-label={tr.close} onClick={() => setSideOpen(false)} />}
    <aside id="workspace-sidebar" className={`ws-sidebar ${sideOpen ? 'is-open' : ''} ${sideCollapsed ? 'is-collapsed' : ''}`} aria-label={tr.navigation}>
      <div className="ws-sidebar-heading"><button className="ws-brand" onClick={() => { collapseChat(); navigate('projects'); setSideOpen(false); }}><span>{PRODUCT_NAME}<span>{tr.scopeHint}</span></span></button><button className="ws-icon-button ws-sidebar-toggle" aria-label={sideCollapsed ? tr.expandSidebar : tr.collapseSidebar} title={sideCollapsed ? tr.expandSidebar : tr.collapseSidebar} aria-expanded={!sideCollapsed} aria-controls="workspace-sidebar" onClick={toggleSideCollapsed}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /><path className="ws-sidebar-toggle-arrow" d="m16 9-3 3 3 3" /></svg></button></div>
      <p className="ws-nav-label">{tr.workspace}</p>
      <nav><button className={`ws-nav-item ${surface === 'projects' && !chatExpanded ? 'selected' : ''}`} aria-label={tr.myProjects} title={tr.myProjects} onClick={() => { collapseChat(); navigate('projects'); setSideOpen(false); }}><Icon name="projects" /><span>{tr.myProjects}</span><small>{Object.values(projects).filter((p) => !p.archived).length}</small></button>
        <button className={`ws-nav-item ${chatExpanded ? 'selected' : ''}`} aria-label="Chat" aria-current={chatExpanded ? 'page' : undefined} title="Chat" onClick={() => { useChatStore.getState().setOpen(true); useChatPresentation.getState().setExpanded(true); setSideOpen(false); }}><ChatBubbleIcon size={18}/><span>Chat</span></button>
        <button className={`ws-nav-item ${surface === 'notes' && !noteScope && !chatExpanded ? 'selected' : ''}`} aria-label={tr.diary} aria-current={surface === 'notes' && !noteScope && !chatExpanded ? 'page' : undefined} title={tr.diary} onClick={() => { collapseChat(); setNoteScope(null); setNoteId(null); navigate('notes'); setSideOpen(false); }}><Icon name="notes" /><span>{tr.diary}</span></button>
        <button className={`ws-nav-item ${surface === 'boards' && !chatExpanded ? 'selected' : ''}`} aria-label="Dynamic Board" aria-current={surface === 'boards' && !chatExpanded ? 'page' : undefined} title="Dynamic Board" onClick={() => { collapseChat(); useWorkspaceStore.setState({ activeBoardId: null }); navigate('boards'); setSideOpen(false); }}><DashboardIcon width={18} height={18} aria-hidden="true"/><span>Dynamic Board</span></button>
      </nav>
      {project && <><p className="ws-nav-label ws-project-nav-title" title={project.name}><ProjectIcon appearance={project.appearance} size={14}/><span>{project.name}</span>{project.archived && <span className="ws-badge">{tr.archived}</span>}</p><nav>{(['planner', 'overview', 'kanban', 'scrum', 'notes'] as const).map(navItem)}</nav></>}
      <div className="ws-sidebar-bottom"><button className="ws-nav-item" aria-label={tr.preferences} title={tr.preferences} aria-haspopup="dialog" aria-expanded={settings} onClick={() => setSettings(true)}><GearIcon width={18} height={18} aria-hidden="true" /><span>{tr.preferences}</span></button><div className="ws-sidebar-tools"><LanguageToggle /><span><i />{isCloudEnabled() ? 'Workspace na nuvem' : tr.localData}</span></div></div>
    </aside>
    <div className="ws-main"><div className="dd-chat-mobile-navigation" hidden={!chatExpanded}>{mobileMenu}</div><FullChatDock/>{surface === 'planner' && project && <header className="ws-header" hidden={chatExpanded}>
      {mobileMenu}
      <div className="ws-breadcrumb">
        <button onClick={() => navigate('projects')}>{tr.projects}</button><span>/</span><button className="ws-project-identity" title={project.name} onClick={() => go('overview')}><ProjectIcon appearance={project.appearance} size={14}/><span>{project.name}</span></button><span>/</span>
        <strong>{tr.planner}</strong>
      </div>
      {project?.archived && <span className="ws-badge">{tr.archived}</span>}
      <button className="ws-button small ws-push-right" onClick={() => go('overview')}>{tr.backWorkspace}</button>
    </header>}
      <PageHeaderContext.Provider value={headerShell}>
      <Suspense fallback={<div role="status" aria-busy="true" className="ws-page">{english ? 'Loading…' : 'Carregando…'}</div>}>
      <main hidden={chatExpanded} className={`ws-content ${surface === 'boards' ? 'is-boards' : ''} ${surface === 'notes' ? 'is-notes' : ''} ${project && (surface === 'kanban' || surface === 'scrum') ? 'is-execution' : ''} ${surface === 'planner' && project ? 'is-planner' : ''}`} key={`${surface}-${surface === 'notes' ? noteScope : surface === 'boards' ? 'boards' : activeProjectId}`}>
        {surface === 'boards' ? <DynamicBoards english={english} onMaximizedChange={setBoardMaximized}/> : surface === 'projects' ? <Projects /> : surface === 'notes' ? <Notes key={`${noteScope}-${noteId}`} projectId={noteScope} initialNoteId={noteId} onMaximizedChange={setNoteMaximized} /> : !project ? <Projects /> : surface === 'overview' ? <Overview project={project} onAdd={() => setTaskEditor({})} onPlan={() => go('planner')} onNotes={openNotes} onEditProject={() => setEditingProject(true)} /> : surface === 'kanban' ? <Board projectId={project.id} onEdit={(task) => setTaskEditor({ task })} onAdd={(status) => setTaskEditor({ status })} /> : surface === 'scrum' ? <Scrum projectId={project.id} onEdit={(task) => setTaskEditor({ task })} onAdd={() => setTaskEditor({})} /> : planner}
      </main>
      </Suspense>
      </PageHeaderContext.Provider>
    </div>
    {settings && <ApiKeyGate title={tr.preferences} onClose={() => setSettings(false)} preferences={
      <div className="mb-5 space-y-5">
        <label className="flex flex-col gap-2 text-control font-medium text-text-primary">
          <span>{tr.appearance}</span>
          <select className="field" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="oled">{tr.themeOled}</option><option value="dark">{tr.themeDark}</option><option value="light">{tr.themeLight}</option>
          </select>
        </label>
        <InstallApp />
        <CloudDataControls />
        <div className="border-t border-border-base/70 pt-4"><h3 className="text-control font-semibold text-text-primary">{tr.settings}</h3></div>
      </div>
    } />}
    <AssistantChat suspended={canvasMaximized || boardMaximized || noteMaximized && !chatOpen} />
    {editingProject && project && <ProjectForm project={project} onClose={() => setEditingProject(false)} />}
    {taskEditor && project && <TaskEditor key={taskEditor.task?.id ?? 'new'} projectId={project.id} task={taskEditor.task} initialStatus={taskEditor.status} onClose={() => setTaskEditor(null)} onSource={source} />}
  </div></AssistantChatDockProvider>;
}
