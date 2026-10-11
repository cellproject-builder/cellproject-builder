import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  useGraphStore,
  breadcrumbFor,
  isDemoProject,
  projectProgress,
  projectEvidenceProgress,
  type Lens,
  type ViewMode,
} from '@/store';
import { useKBStore } from '@/kb/store';
import { getActiveConfig, useConfigStore, PROVIDER_LABELS, KNOWN_MODELS } from '@/config/store';
import { useT } from '@/i18n';
import { useReviewingParents } from '@/hooks/useReviewingParents';
import { toast } from '@/components/ui/Toast';
import { KnowledgeRepo } from './KnowledgeRepo';
import { ApiKeyGate } from './ApiKeyGate';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { hasActiveAIActions } from '@/ai/actions';
import { exportVisualPlan, prepareVisualPlanImport, watchVisualImportContext } from '@/visuals/portable';
import { PageHeaderContext } from '@/workspace/PageHeader';
import './planner-mobile.css';

// Nome curto do modelo ativo: rótulo conhecido, senão o id sem o prefixo do
// provider ("openai/gpt-6.1-sol" → "gpt-6.1-sol").
const modelLabel = (provider: keyof typeof KNOWN_MODELS, id: string): string =>
  KNOWN_MODELS[provider]?.find((m) => m.id === id)?.label ?? id.split('/').pop() ?? id;

export function TopBar() {
  const tr = useT();
  const shell = useContext(PageHeaderContext);
  const project = useGraphStore((s) => s.project);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const lens = useGraphStore((s) => s.lens);
  const viewMode = useGraphStore((s) => s.viewMode);
  const setLens = useGraphStore((s) => s.setLens);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const resetProject = useGraphStore((s) => s.resetProject);
  const undoReset = useGraphStore((s) => s.undoReset);
  const importProject = useGraphStore((s) => s.importProject);
  const archivedProject = useGraphStore((s) => s.archivedProject);
  const kbCount = useKBStore((s) => Object.keys(s.docs).length);
  const activeProvider = useConfigStore(() => getActiveConfig()?.provider ?? null);
  const activeModel = useConfigStore(() => getActiveConfig()?.config.mainModel ?? null);
  const [kbOpen, setKbOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // "Novo projeto" com um arquivado já guardado: o 2º clique confirma (o
  // arquivo tem uma vaga só — o arquivado anterior seria descartado).
  const [confirmNew, setConfirmNew] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuByKeyboard = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importAttemptRef = useRef(0);

  const LENSES: { value: Lens; label: string; key: string }[] = [
    { value: 'structure', label: tr.topBar.lensStructure, key: '1' },
    { value: 'flow', label: tr.topBar.lensFlow, key: '2' },
    { value: 'risk', label: tr.topBar.lensRisk, key: '3' },
    { value: 'state', label: tr.topBar.lensState, key: '4' },
    { value: 'connections', label: tr.topBar.lensConnections, key: '5' },
  ];

  const VIEWS: { value: ViewMode; label: string; description: string }[] = [
    { value: 'tutor', label: tr.topBar.viewTutor, description: tr.topBar.viewTutorAria },
    { value: 'graph', label: tr.topBar.viewGraph, description: tr.topBar.viewGraphAria },
  ];

  // Menu ⋯: fecha no clique fora e no Esc (devolvendo o foco ao botão);
  // setas navegam entre os itens.
  useEffect(() => {
    if (!menuOpen) setConfirmNew(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const items = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter(item => item.getClientRects().length > 0);
    // Só o teclado leva o foco ao primeiro item (como no macOS): aberto com
    // o ponteiro, nenhum item abre realçado.
    if (menuByKeyboard.current) items()[0]?.focus();
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        if (list.length === 0) return;
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next =
          i < 0
            ? e.key === 'ArrowDown'
              ? 0
              : list.length - 1
            : e.key === 'ArrowDown'
            ? (i + 1) % list.length
            : (i - 1 + list.length) % list.length;
        list[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  const crumbs = breadcrumbFor(project, selectedId);
  const shortName = (project?.name ?? '').replace(/^demo\s*[·:\-–—]\s*/i, '');
  // Anel da toolbar: o mesmo seletor de progresso da StatusBar e do tutor.
  const reviewing = useReviewingParents();
  const progress = useMemo(() => projectProgress(project, reviewing), [project, reviewing]);
  const evidence = useMemo(() => projectEvidenceProgress(project, reviewing), [project, reviewing]);
  const inDemo = isDemoProject(project);
  const otherArchived = archivedProject && archivedProject.id !== project?.id ? archivedProject : null;
  // Sair da demo não arquiva nada — o arquivado continua intacto.
  const newWouldDiscard = !inDemo && otherArchived !== null;

  const exportJson = async () => {
    if (!project) return;
    try {
    const payload = await exportVisualPlan(project);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    } catch (error) {
      toast.show({ message: error instanceof Error && error.message === 'visualExportTooLarge' ? 'A exportação visual permite até 40 MiB de arquivos originais.' : 'Não foi possível exportar todos os arquivos visuais. Confira se os originais estão disponíveis.', tone: 'warn' });
    }
  };

  // "Novo projeto" não destrói: o atual vai pro arquivo e o toast desfaz.
  // A demo não é arquivada (não há o que perder).
  const canChangeContext = () => {
    if (!hasActiveAIActions()) return true;
    toast.show({ message: tr.workspace.errors.plannerBusy, tone: 'warn' });
    return false;
  };
  const handleNewProject = () => {
    if (!canChangeContext()) return;
    const wasDemo = inDemo;
    const prevView = viewMode;
    resetProject();
    if (wasDemo) {
      toast.show({ message: tr.topBar.demoClosed, tone: 'info' });
      return;
    }
    toast.show({
      message: tr.topBar.projectArchived,
      tone: 'info',
      durationMs: 10000,
      action: {
        label: tr.common.undo,
        // Volta para a mesma vista em que o usuário estava (grafo ou tutor).
        onClick: () => {
          if (canChangeContext() && undoReset()) setViewMode(prevView);
        },
      },
    });
  };

  // Reabre o arquivado; o atual (se houver) vai para o arquivo no lugar dele.
  const handleReopenArchived = () => {
    if (!canChangeContext()) return;
    if (!otherArchived) return;
    const name = otherArchived.name;
    if (undoReset()) toast.show({ message: tr.topBar.reopenedArchived(name), tone: 'ok' });
  };

  const handleImportFile = (file: File) => {
    if (!canChangeContext()) return;
    if (file.size > 60 * 1024 * 1024) { toast.show({ message: 'O JSON de importação deve ter até 60 MiB.', tone: 'warn' }); return; }
    const guard = watchVisualImportContext(), attempt = ++importAttemptRef.current;
    const reader = new FileReader();
    reader.onerror = () => { guard.dispose(); toast.show({ message: tr.topBar.importReadError, tone: 'warn' }); };
    reader.onabort = () => guard.dispose();
    reader.onload = async () => {
      try {
      if (!canChangeContext()) return;
      let json: unknown;
      try {
        json = JSON.parse(String(reader.result ?? ''));
      } catch {
        toast.show({ message: tr.topBar.importNotJson, tone: 'warn' });
        return;
      }
      guard.assert();
      if (attempt !== importAttemptRef.current) return;
      const prepared = await prepareVisualPlanImport(json);
      guard.assert();
      if (attempt !== importAttemptRef.current || !canChangeContext()) return;
      const current = useGraphStore.getState().project;
      const hadProject = Boolean(current) && !isDemoProject(current);
      const result = importProject(prepared);
      if (!result.ok) {
        toast.show({ message: tr.topBar.importFailed(result.error), tone: 'warn' });
        return;
      }
      const name = useGraphStore.getState().project?.name ?? '';
      toast.show({
        message: tr.topBar.imported(name),
        tone: 'ok',
        durationMs: hadProject ? 10000 : undefined,
        // O projeto anterior foi arquivado pelo import — dá pra voltar.
        action: hadProject ? { label: tr.common.undo, onClick: () => { if (canChangeContext()) undoReset(); } } : undefined,
      });
      } catch (error) {
        toast.show({ message: error instanceof Error && error.message === 'visualImportContextChanged' ? 'O projeto mudou durante a leitura. Importe o arquivo novamente no projeto desejado.' : tr.topBar.importFailed(error instanceof Error ? error.message : tr.topBar.importReadError), tone: 'warn' });
      } finally { guard.dispose(); }
    };
    reader.readAsText(file);
  };

  // Itens de menu estilo macOS: realce accent sólido no hover/foco.
  const menuItemClass =
    'tap group w-full text-left px-2.5 min-h-[28px] [@media(pointer:coarse)]:min-h-[44px] py-1 text-control rounded-chip text-text-primary outline-none transition-colors duration-120 ease-mac flex items-center justify-between gap-3 hover:bg-accent-solid hover:text-accent-fg focus-visible:bg-accent-solid focus-visible:text-accent-fg focus-visible:outline-none';
  const menuHintClass =
    'min-w-0 truncate text-right text-footnote text-text-muted group-hover:text-accent-fg/80 group-focus-visible:text-accent-fg/80';

  const modelName = activeProvider && activeModel ? modelLabel(activeProvider, activeModel) : null;
  const progressLabel = tr.topBar.progressLabel(progress.done, progress.total, evidence.withEvidence, evidence.assumedKnown);

  return (
    <header className={`planner-topbar ${shell ? 'is-integrated' : ''} glass-host border-b relative z-20 shrink-0 min-h-[calc(52px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] flex items-center px-3 sm:px-4 gap-1.5 sm:gap-3 text-control`}>
      {shell?.navigation}
      <div className="planner-project-summary flex items-center gap-2 min-w-0 overflow-hidden">
        {shell ? <><nav className="planner-workspace-location ws-breadcrumb" aria-label={tr.topBar.breadcrumbAria}>
          {shell.breadcrumb}<strong className="planner-surface-label">{tr.workspace.planner}</strong>
        </nav>{shell.status}</> : <>
        <span className="text-text-primary font-semibold truncate hidden sm:inline">{project?.name}</span>
        {/* Mobile: sem o prefixo "Demo ·" — o nome do projeto é o que cabe. */}
        <span className="text-text-primary font-semibold truncate sm:hidden" title={project?.name}>
          {shortName}
        </span>
        </>}
        {inDemo && !shell && (
          <span title={tr.topBar.demoBadgeTitle} className="chip shrink-0 bg-bg-elevated text-text-secondary hidden sm:inline-flex">
            {tr.topBar.demoBadge}
          </span>
        )}
        {progress.total > 0 && (
          <span className="planner-header-progress flex items-center gap-1.5 shrink-0" title={progressLabel}>
            <ProgressRing
              total={progress.total}
              done={progress.done}
              withProof={evidence.withEvidence}
              size={22}
              strokeWidth={2.5}
              label={progressLabel}
            />
            <span aria-hidden className="planner-progress-count sm:hidden text-footnote text-text-muted tabular-nums">
              {progress.done}/{progress.total}
            </span>
            <span aria-hidden className="planner-progress-count hidden sm:inline text-footnote text-text-muted tabular-nums">
              {tr.topBar.progressCompact(progress.done, progress.total, evidence.withEvidence)}
            </span>
          </span>
        )}
        {viewMode === 'graph' && crumbs.some((c) => c.id !== project?.rootId) && (
          <nav
            aria-label={tr.topBar.breadcrumbAria}
            className="planner-node-breadcrumbs hidden lg:flex items-center gap-0.5 min-w-0 overflow-hidden ml-1"
          >
            {/* A raiz é o título do projeto, já na toolbar: começa abaixo dela. */}
            {crumbs.filter((c) => c.id !== project?.rootId).map((c, i, list) => (
              <div key={c.id} className="flex items-center gap-0.5 min-w-0">
                <span aria-hidden className="text-text-faint text-footnote px-0.5">
                  ›
                </span>
                <button
                  onClick={() => {
                    // Seleciona e enquadra a subárvore (o GraphCanvas consome
                    // focusVersion).
                    selectNode(c.id);
                    focusNode(c.id);
                  }}
                  title={tr.topBar.breadcrumbTitle(c.name)}
                  className={`text-footnote truncate max-w-[180px] px-1 py-0.5 rounded-chip hover:bg-bg-elevated hover:text-text-primary transition-colors duration-120 ease-mac ${
                    i === list.length - 1 ? 'text-text-primary font-medium' : 'text-text-muted'
                  }`}
                >
                  {c.name}
                </button>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="planner-topbar-spacer flex-1" />

      <div className="planner-view-switch segmented shrink-0">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            onClick={() => setViewMode(v.value)}
            aria-label={v.description}
            title={v.description}
            aria-pressed={viewMode === v.value}
            className="segmented-item"
          >
            {v.label}
          </button>
        ))}
      </div>

      {viewMode === 'graph' && (
        <>
          {/* Mobile: o seletor de lente flutua no canvas (GraphCanvas) — aqui o
              título do projeto precisa do espaço. */}
          <div role="group" aria-label={tr.topBar.lensSelectAria} className="planner-header-lenses segmented shrink-0">
            {LENSES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLens(l.value)}
                title={tr.topBar.lensTitle(l.label, l.key)}
                aria-pressed={lens === l.value}
                className="segmented-item"
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="planner-header-divider w-px h-5 bg-border-base shrink-0" aria-hidden />

      <button
        onClick={() => setSettingsOpen(true)}
        className="planner-model-action tap btn btn-ghost shrink-0 max-w-[220px]"
        title={
          activeProvider
            ? tr.topBar.modelTitle(PROVIDER_LABELS[activeProvider], activeModel ?? '')
            : tr.topBar.settingsTitleEmpty
        }
        aria-label={tr.topBar.settings}
      >
        <GearIcon />
        {modelName && <span className="font-sans text-footnote text-text-muted truncate">{modelName}</span>}
      </button>

      {shell?.onOverview && <button className="planner-overview-action tap btn btn-ghost shrink-0" onClick={shell.onOverview}>{tr.workspace.backWorkspace}</button>}

      <div className="relative shrink-0" ref={menuRef}>
        <button
          ref={menuButtonRef}
          onClick={(e) => {
            // detail === 0: ativado por Enter/Espaço, não por clique.
            menuByKeyboard.current = e.detail === 0;
            setMenuOpen((o) => !o);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !menuOpen) {
              e.preventDefault();
              menuByKeyboard.current = true;
              setMenuOpen(true);
            }
          }}
          aria-label={tr.topBar.moreActions}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`tap btn btn-ghost btn-icon text-[15px] ${menuOpen ? '!bg-bg-elevated !text-text-primary' : ''}`}
        >
          <span aria-hidden>⋯</span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label={tr.topBar.moreActions}
            className="glass bg-glass/90 border absolute right-0 top-full mt-1.5 w-64 rounded-card shadow-mac-lg z-30 p-1 origin-top-right animate-sheet-in"
          >
            <button
              role="menuitem"
              onClick={() => {
                if (newWouldDiscard && !confirmNew) {
                  setConfirmNew(true);
                  return;
                }
                setMenuOpen(false);
                handleNewProject();
              }}
              className={`${menuItemClass} ${
                !inDemo && confirmNew
                  ? 'text-state-problem hover:!text-accent-fg focus-visible:!text-accent-fg'
                  : ''
              }`}
            >
              {confirmNew && otherArchived ? (
                <span>{tr.topBar.newProjectConfirmDiscard(otherArchived.name)}</span>
              ) : (
                <>
                  <span className="whitespace-nowrap shrink-0">{inDemo ? tr.topBar.demoExit : tr.topBar.newProject}</span>
                  {!inDemo && (
                    <span className={menuHintClass}>
                      {otherArchived ? tr.topBar.newProjectHintReplaces : tr.topBar.newProjectHint}
                    </span>
                  )}
                </>
              )}
            </button>
            {otherArchived && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  handleReopenArchived();
                }}
                className={menuItemClass}
              >
                <span className="truncate">{tr.topBar.reopenArchived(otherArchived.name)}</span>
                {!inDemo && <span className={`${menuHintClass} shrink-0`}>{tr.topBar.reopenArchivedHint}</span>}
              </button>
            )}
            <div role="separator" className="divider my-1 mx-2.5" />
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className={menuItemClass}
            >
              {tr.topBar.importJson}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                void exportJson();
                setMenuOpen(false);
              }}
              className={menuItemClass}
            >
              {tr.topBar.exportJson}
            </button>
            {shell?.onOverview && <button role="menuitem" className={`${menuItemClass} planner-overview-menu`} onClick={() => { setMenuOpen(false); shell.onOverview?.(); }}>{tr.workspace.backWorkspace}</button>}
            {viewMode === 'graph' && <div className="planner-lens-menu">
              <div role="separator" className="divider my-1 mx-2.5" />
              <div role="group" aria-label={tr.topBar.lensSelectAria}>
                {LENSES.map(option => <button key={option.value} role="menuitemradio" aria-checked={lens === option.value} className={menuItemClass}
                  onClick={() => { setLens(option.value); setMenuOpen(false); }}>{option.label}<span aria-hidden>{lens === option.value ? '✓' : ''}</span></button>)}
              </div>
            </div>}
            <div role="separator" className="planner-secondary-menu divider my-1 mx-2.5" />
            <button
              role="menuitem"
              onClick={() => {
                setKbOpen(true);
                setMenuOpen(false);
              }}
              className={menuItemClass}
            >
              <span>{tr.topBar.myPdfs}</span>
              {kbCount > 0 && <span className={`${menuHintClass} tabular-nums`}>{kbCount}</span>}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSettingsOpen(true);
                setMenuOpen(false);
              }}
              // No desktop o botão de ajustes já está na toolbar.
              className={`${menuItemClass} planner-secondary-menu`}
            >
              <span>{tr.topBar.settingsAction}</span>
              {modelName && (
                <span className={`${menuHintClass} truncate max-w-[120px]`}>{modelName}</span>
              )}
            </button>
          </div>
        )}
        <input name="import-file"
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            // Permite reimportar o mesmo arquivo.
            e.target.value = '';
          }}
        />
      </div>

      <KnowledgeRepo open={kbOpen} onClose={() => setKbOpen(false)} />
      {settingsOpen && <ApiKeyGate onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}

// Engrenagem de 14px (traço fino, herda a cor do botão).
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="4.8" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.2v2M8 12.8v2M14.8 8h-2M3.2 8h-2M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4M12.8 12.8l-1.4-1.4M4.6 4.6L3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
