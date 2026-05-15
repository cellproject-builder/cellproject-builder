import { useEffect, useRef, useState } from 'react';
import { useGraphStore, breadcrumbFor, isDemoProject, type Lens, type ViewMode } from '@/store';
import { useKBStore } from '@/kb/store';
import { useConfigStore, PROVIDER_LABELS } from '@/config/store';
import { useT } from '@/i18n';
import { KnowledgeRepo } from './KnowledgeRepo';
import { ApiKeyGate } from './ApiKeyGate';
import { Logo } from './Logo';

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
  const kbCount = useKBStore((s) => Object.keys(s.docs).length);
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const [kbOpen, setKbOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [overflowOpen]);

  const crumbs = breadcrumbFor(project, selectedId);
  const inDemo = isDemoProject(project);

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

  const handleReset = () => {
    const msg = inDemo ? tr.topBar.demoExitConfirm : tr.topBar.resetConfirm;
    if (confirm(msg)) {
      resetProject();
    }
  };

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
        {viewMode === 'graph' && (
          <div className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden">
            <span className="text-text-muted mx-1">/</span>
            {crumbs.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-text-muted text-xs">›</span>}
                <button
                  onClick={() => {
                    selectNode(c.id);
                    focusNode(c.id);
                  }}
                  className={`text-xs truncate hover:text-text-primary transition-colors ${
                    i === crumbs.length - 1 ? 'text-text-primary' : 'text-text-muted'
                  }`}
                >
                  {c.name}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1 border border-border-base rounded-sm bg-bg-primary p-0.5 shrink-0">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            onClick={() => setViewMode(v.value)}
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
        className="px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors flex items-center gap-1.5 shrink-0 min-h-[32px]"
        title={tr.topBar.kbTitle}
      >
        <span>{tr.topBar.kb}</span>
        {kbCount > 0 && (
          <span className="font-mono text-[10px] text-ai-accent bg-ai-accent/10 px-1 rounded-[2px]">
            {kbCount}
          </span>
        )}
      </button>

      <button
        onClick={exportJson}
        className="hidden md:block px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors shrink-0"
      >
        {tr.topBar.export}
      </button>

      <button
        onClick={() => setSettingsOpen(true)}
        className="hidden md:flex px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors items-center gap-1.5 shrink-0"
        title={
          activeProvider
            ? tr.topBar.settingsTitle(PROVIDER_LABELS[activeProvider])
            : tr.topBar.settingsTitleEmpty
        }
      >
        <span>⚙</span>
        {activeProvider && (
          <span className="font-mono text-[10px] text-ai-accent uppercase">
            {activeProvider}
          </span>
        )}
      </button>

      <button
        onClick={handleReset}
        className={`hidden md:block px-2.5 py-1 text-xs border rounded-sm transition-colors shrink-0 ${
          inDemo
            ? 'border-ai-accent/40 text-ai-accent hover:bg-ai-accent/10'
            : 'border-border-base text-text-muted hover:text-state-problem hover:border-state-problem/40'
        }`}
      >
        {inDemo ? tr.topBar.demoExit : tr.topBar.reset}
      </button>

      <div className="md:hidden relative shrink-0" ref={overflowRef}>
        <button
          onClick={() => setOverflowOpen((o) => !o)}
          aria-label={tr.topBar.moreActions}
          aria-expanded={overflowOpen}
          className="px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors min-h-[32px] min-w-[32px]"
        >
          ⋯
        </button>
        {overflowOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-bg-secondary border border-border-base rounded-sm shadow-lg z-30 py-1">
            <button
              onClick={() => {
                exportJson();
                setOverflowOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-xs text-text-secondary hover:bg-bg-elevated transition-colors"
            >
              {tr.topBar.exportJson}
            </button>
            <button
              onClick={() => {
                setSettingsOpen(true);
                setOverflowOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-xs text-text-secondary hover:bg-bg-elevated transition-colors flex items-center justify-between"
            >
              <span>{tr.topBar.settingsAction}</span>
              {activeProvider && (
                <span className="font-mono text-[10px] text-ai-accent uppercase">
                  {activeProvider}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                handleReset();
                setOverflowOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 text-xs hover:bg-bg-elevated transition-colors ${
                inDemo
                  ? 'text-ai-accent'
                  : 'text-text-muted hover:text-state-problem'
              }`}
            >
              {inDemo ? tr.topBar.demoExit : tr.topBar.reset}
            </button>
          </div>
        )}
      </div>

      <KnowledgeRepo open={kbOpen} onClose={() => setKbOpen(false)} />
      {settingsOpen && <ApiKeyGate onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
