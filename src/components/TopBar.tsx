import { useEffect, useRef, useState } from 'react';
import { useGraphStore, breadcrumbFor, type Lens, type ViewMode } from '@/store';
import { useKBStore } from '@/kb/store';
import { useConfigStore, PROVIDER_LABELS } from '@/config/store';
import { KnowledgeRepo } from './KnowledgeRepo';
import { ApiKeyGate } from './ApiKeyGate';

const LENSES: { value: Lens; label: string; key: string }[] = [
  { value: 'structure', label: 'Estrutura', key: '1' },
  { value: 'flow', label: 'Fluxo', key: '2' },
  { value: 'risk', label: 'Risco', key: '3' },
  { value: 'state', label: 'Estado', key: '4' },
  { value: 'connections', label: 'Conexões', key: '5' },
];

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'tutor', label: 'Tutor' },
  { value: 'graph', label: 'Grafo' },
];

export function TopBar() {
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
    if (confirm('Descartar projeto atual e começar de novo?')) {
      resetProject();
    }
  };

  return (
    <div className="min-h-11 shrink-0 border-b border-border-base bg-bg-secondary flex items-center px-2 sm:px-3 gap-2 sm:gap-3 text-sm pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-ai-accent font-mono text-xs">◆</span>
        <span className="text-text-primary font-semibold truncate">{project?.name}</span>
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
            aria-label="Lente do grafo"
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
                title={`Lente ${l.label} (${l.key})`}
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
        title="Repositório de conhecimento (PDFs)"
      >
        <span>KB</span>
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
        Exportar
      </button>

      <button
        onClick={() => setSettingsOpen(true)}
        className="hidden md:flex px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors items-center gap-1.5 shrink-0"
        title={activeProvider ? `Provider ativo: ${PROVIDER_LABELS[activeProvider]}` : 'Configurar chave de API'}
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
        className="hidden md:block px-2.5 py-1 text-xs border border-border-base rounded-sm text-text-muted hover:text-state-problem hover:border-state-problem/40 transition-colors shrink-0"
      >
        Reset
      </button>

      <div className="md:hidden relative shrink-0" ref={overflowRef}>
        <button
          onClick={() => setOverflowOpen((o) => !o)}
          aria-label="Mais ações"
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
              Exportar JSON
            </button>
            <button
              onClick={() => {
                setSettingsOpen(true);
                setOverflowOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-xs text-text-secondary hover:bg-bg-elevated transition-colors flex items-center justify-between"
            >
              <span>⚙ Configurações</span>
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
              className="w-full text-left px-3 py-2.5 text-xs text-text-muted hover:text-state-problem hover:bg-bg-elevated transition-colors"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      <KnowledgeRepo open={kbOpen} onClose={() => setKbOpen(false)} />
      {settingsOpen && <ApiKeyGate onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
