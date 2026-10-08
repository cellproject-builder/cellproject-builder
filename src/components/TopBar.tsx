import { useEffect, useRef, useState } from 'react';
import { useGraphStore, breadcrumbFor, isDemoProject, type Lens, type ViewMode } from '@/store';
import { useKBStore } from '@/kb/store';
import { useConfigStore, PROVIDER_LABELS, KNOWN_MODELS } from '@/config/store';
import { useT } from '@/i18n';
import { toast } from '@/components/ui/Toast';
import { KnowledgeRepo } from './KnowledgeRepo';
import { ApiKeyGate } from './ApiKeyGate';
import { Logo } from './Logo';

// Nome curto do modelo ativo: rótulo conhecido, senão o id sem o prefixo do
// provider ("openai/gpt-6.1-sol" → "gpt-6.1-sol").
const modelLabel = (provider: keyof typeof KNOWN_MODELS, id: string): string =>
  KNOWN_MODELS[provider]?.find((m) => m.id === id)?.label ?? id.split('/').pop() ?? id;

export function TopBar() {
  const tr = useT();
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
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const activeModel = useConfigStore((s) =>
    s.activeProvider ? s.providers[s.activeProvider]?.mainModel ?? null : null,
  );
  const [kbOpen, setKbOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // "Novo projeto" com um arquivado já guardado: o 2º clique confirma (o
  // arquivo tem uma vaga só — o arquivado anterior seria descartado).
  const [confirmNew, setConfirmNew] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const LENSES: { value: Lens; label: string; key: string }[] = [
    { value: 'structure', label: tr.topBar.lensStructure, key: '1' },
    { value: 'flow', label: tr.topBar.lensFlow, key: '2' },
    { value: 'risk', label: tr.topBar.lensRisk, key: '3' },
    { value: 'state', label: tr.topBar.lensState, key: '4' },
    { value: 'connections', label: tr.topBar.lensConnections, key: '5' },
  ];

  const VIEWS: { value: ViewMode; label: string }[] = [
    { value: 'tutor', label: tr.topBar.viewTutor },
    { value: 'graph', label: tr.topBar.viewGraph },
  ];

  // Menu ⋯: fecha no clique fora e no Esc (devolvendo o foco ao botão);
  // setas navegam entre os itens.
  useEffect(() => {
    if (!menuOpen) setConfirmNew(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const items = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
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
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
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
  const inDemo = isDemoProject(project);
  const otherArchived = archivedProject && archivedProject.id !== project?.id ? archivedProject : null;
  // Sair da demo não arquiva nada — o arquivado continua intacto.
  const newWouldDiscard = !inDemo && otherArchived !== null;

  const exportJson = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // "Novo projeto" não destrói: o atual vai pro arquivo e o toast desfaz.
  // A demo não é arquivada (não há o que perder).
  const handleNewProject = () => {
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
          if (undoReset()) setViewMode(prevView);
        },
      },
    });
  };

  // Reabre o arquivado; o atual (se houver) vai para o arquivo no lugar dele.
  const handleReopenArchived = () => {
    if (!otherArchived) return;
    const name = otherArchived.name;
    if (undoReset()) toast.show({ message: tr.topBar.reopenedArchived(name), tone: 'ok' });
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onerror = () => toast.show({ message: tr.topBar.importReadError, tone: 'warn' });
    reader.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(String(reader.result ?? ''));
      } catch {
        toast.show({ message: tr.topBar.importNotJson, tone: 'warn' });
        return;
      }
      const hadProject = Boolean(useGraphStore.getState().project) && !inDemo;
      const result = importProject(json);
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
        action: hadProject ? { label: tr.common.undo, onClick: () => void undoReset() } : undefined,
      });
    };
    reader.readAsText(file);
  };

  const menuItemClass =
    'w-full text-left px-3 py-2.5 min-h-[40px] text-xs text-text-secondary hover:bg-bg-elevated focus:bg-bg-elevated outline-none transition-colors flex items-center justify-between gap-2';

  const modelName = activeProvider && activeModel ? modelLabel(activeProvider, activeModel) : null;

  return (
    <div className="min-h-11 shrink-0 border-b border-border-base bg-bg-secondary flex items-center px-2 sm:px-3 gap-2 sm:gap-3 text-sm pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-1.5 min-w-0">
        <Logo size={16} className="text-text-primary shrink-0" />
        <span className="text-text-primary font-semibold truncate">{project?.name}</span>
        {inDemo && (
          <span
            title={tr.topBar.demoBadgeTitle}
            className="shrink-0 font-mono text-[9px] tracking-widest text-ai-accent border border-ai-accent/40 bg-ai-accent/10 px-1.5 py-[1px] rounded-[2px] uppercase"
          >
            {tr.topBar.demoBadge}
          </span>
        )}
        {viewMode === 'graph' && crumbs.length > 0 && (
          <nav
            aria-label={tr.topBar.breadcrumbAria}
            className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden"
          >
            <span className="text-text-muted mx-1">/</span>
            {crumbs.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-text-muted text-xs">›</span>}
                <button
                  onClick={() => {
                    // Seleciona e enquadra a subárvore (o GraphCanvas consome
                    // focusVersion).
                    selectNode(c.id);
                    focusNode(c.id);
                  }}
                  title={tr.topBar.breadcrumbTitle(c.name)}
                  className={`text-xs truncate max-w-[180px] hover:text-text-primary transition-colors ${
                    i === crumbs.length - 1 ? 'text-text-primary' : 'text-text-muted'
                  }`}
                >
                  {c.name}
                </button>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1 border border-border-base rounded-sm bg-bg-primary p-0.5 shrink-0">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            onClick={() => setViewMode(v.value)}
            aria-pressed={viewMode === v.value}
            className={`px-2.5 py-1 text-[11px] font-mono rounded-[2px] transition-colors min-h-[28px] ${
              viewMode === v.value
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {viewMode === 'graph' && (
        <>
          <select
            value={lens}
            onChange={(e) => setLens(e.target.value as Lens)}
            aria-label={tr.topBar.lensSelectAria}
            className="md:hidden bg-bg-primary border border-border-base rounded-sm text-text-secondary text-[11px] px-2 py-1 font-mono shrink-0"
          >
            {LENSES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <div className="hidden md:flex items-center gap-1 border border-border-base rounded-sm bg-bg-primary p-0.5 shrink-0">
            {LENSES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLens(l.value)}
                title={tr.topBar.lensTitle(l.label, l.key)}
                aria-pressed={lens === l.value}
                className={`px-2 py-0.5 text-[11px] font-mono rounded-[2px] transition-colors ${
                  lens === l.value
                    ? 'bg-bg-elevated text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        onClick={() => setKbOpen(true)}
        className="hidden sm:flex px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors items-center gap-1.5 shrink-0 min-h-[32px]"
        title={tr.topBar.kbTitle}
      >
        <span>{tr.topBar.myPdfs}</span>
        {kbCount > 0 && (
          <span className="font-mono text-[10px] text-ai-accent bg-ai-accent/10 px-1 rounded-[2px]">
            {kbCount}
          </span>
        )}
      </button>

      <button
        onClick={() => setSettingsOpen(true)}
        className="hidden md:flex px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors items-center gap-1.5 shrink-0 min-h-[32px] max-w-[220px]"
        title={
          activeProvider
            ? tr.topBar.modelTitle(PROVIDER_LABELS[activeProvider], activeModel ?? '')
            : tr.topBar.settingsTitleEmpty
        }
        aria-label={tr.topBar.settings}
      >
        <span aria-hidden>⚙</span>
        {modelName && (
          <span className="font-mono text-[10px] text-ai-accent truncate">{modelName}</span>
        )}
      </button>

      <div className="relative shrink-0" ref={menuRef}>
        <button
          ref={menuButtonRef}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={tr.topBar.moreActions}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors min-h-[32px] min-w-[32px]"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label={tr.topBar.moreActions}
            className="absolute right-0 top-full mt-1 w-56 bg-bg-secondary border border-border-base rounded-sm shadow-lg z-30 py-1"
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
              className={`${menuItemClass} ${inDemo ? 'text-ai-accent' : confirmNew ? 'text-state-problem' : ''}`}
            >
              {confirmNew && otherArchived ? (
                <span>{tr.topBar.newProjectConfirmDiscard(otherArchived.name)}</span>
              ) : (
                <>
                  <span>{inDemo ? tr.topBar.demoExit : tr.topBar.newProject}</span>
                  {!inDemo && (
                    <span className="text-[10px] text-text-muted">
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
                {!inDemo && <span className="text-[10px] text-text-muted shrink-0">{tr.topBar.reopenArchivedHint}</span>}
              </button>
            )}
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
                exportJson();
                setMenuOpen(false);
              }}
              className={menuItemClass}
            >
              {tr.topBar.exportJson}
            </button>
            <div role="separator" className="my-1 border-t border-border-base" />
            <button
              role="menuitem"
              onClick={() => {
                setKbOpen(true);
                setMenuOpen(false);
              }}
              className={`${menuItemClass} sm:hidden`}
            >
              <span>{tr.topBar.myPdfs}</span>
              {kbCount > 0 && <span className="font-mono text-[10px] text-ai-accent">{kbCount}</span>}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSettingsOpen(true);
                setMenuOpen(false);
              }}
              className={menuItemClass}
            >
              <span>{tr.topBar.settingsAction}</span>
              {modelName && (
                <span className="font-mono text-[10px] text-ai-accent truncate max-w-[110px]">
                  {modelName}
                </span>
              )}
            </button>
          </div>
        )}
        <input
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
    </div>
  );
}
