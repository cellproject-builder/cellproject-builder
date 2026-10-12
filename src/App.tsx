import { useEffect, useState, lazy, Suspense } from 'react';
import { isPublicDemo } from '@/demo/session';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '@/store';
import { setAIUnavailableHandler } from '@/ai/availability';
import { useConfigStore } from '@/config/store';
import { useLocaleStore, useT } from '@/i18n';
import { ObjectiveScreen } from '@/components/ObjectiveScreen';
import { TopBar } from '@/components/TopBar';
import { StatusBar } from '@/components/StatusBar';
import { GraphCanvas } from '@/components/GraphCanvas';
import { DetailPanel } from '@/components/DetailPanel';
import { TutorMode } from '@/components/TutorMode';
import { ApiKeyGate } from '@/components/ApiKeyGate';
import { PRODUCT_NAME } from '@/brand';
import { Toaster, toast } from '@/components/ui/Toast';
import { Workspace } from '@/workspace/Workspace';
import { useWorkspaceStore } from '@/workspace/store';
import { useChatStore } from '@/chat/store';
import { useKBStore } from '@/kb/store';
import { useChatReferenceHandoff } from '@/references/chatHandoff';
import { useChatPresentation } from '@/chat/presentation';
import { useIsMobile } from '@/hooks/useMediaQuery';
// Route-split: the marketing page is only shown on /landing, so app users
// never download it and /landing visitors don't pull the whole app.
const LandingPage = lazy(() =>
  import('@/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
);

// Os stores persistidos hidratam do IndexedDB de forma assíncrona. Antes disso
// `providers` está vazio e o app piscaria o ApiKeyGate para quem já tem chave.
const persistedStores = [useGraphStore, useConfigStore, useLocaleStore, useWorkspaceStore, useChatStore, useKBStore] as const;

function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() =>
    persistedStores.every((s) => s.persist.hasHydrated()),
  );
  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (persistedStores.every((s) => s.persist.hasHydrated())) setHydrated(true);
    };
    const unsubs = persistedStores.map((s) => s.persist.onFinishHydration(check));
    check(); // pode ter terminado entre o render e o efeito
    return () => unsubs.forEach((u) => u());
  }, [hydrated]);
  return hydrated;
}

// A focused control or conversation owns its keys, including SVG descendants.
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (target as HTMLElement).isContentEditable || !!target.closest(
    'input,textarea,select,button,a[href],summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="menuitem"],[role="tab"],[role="option"],[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],.dd-chat',
  );
}

const LENS_KEYS = {
  '1': 'structure',
  '2': 'flow',
  '3': 'risk',
  '4': 'state',
  '5': 'connections',
} as const;

// Atalhos globais: t = tutor, g = grafo, 1-5 = lentes (só no grafo).
export function handleAppShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'> & Partial<Pick<KeyboardEvent, 'defaultPrevented' | 'isComposing'>>,
): void {
  if (useWorkspaceStore.getState().surface !== 'planner') return;
  if (e.defaultPrevented || e.isComposing || useChatPresentation.getState().expanded) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (isInteractiveTarget(e.target)) return;
  // Superfície modal aberta (modo leitura, sheet mobile): atalhos de uma
  // letra trocariam a view e desmontariam o overlay no meio da leitura.
  if (document.querySelector('[aria-modal="true"]')) return;
  const { project, viewMode, setViewMode, setLens } = useGraphStore.getState();
  if (!project) return;
  if (e.key === 't') setViewMode('tutor');
  else if (e.key === 'g') setViewMode('graph');
  // Lentes só existem no grafo — no tutor 1-5 mudariam algo invisível.
  else if (viewMode === 'graph' && e.key in LENS_KEYS) {
    setLens(LENS_KEYS[e.key as keyof typeof LENS_KEYS]);
  }
}

function Splash() {
  const tr = useT();
  return (
    <div
      className="h-[100dvh] w-full flex items-center justify-center bg-bg-primary"
      aria-busy="true"
      aria-label={tr.app.loading}
    >
      <span className="text-text-muted animate-pulse-subtle">{PRODUCT_NAME}</span>
    </div>
  );
}

export default function App() {
  const hydrated = useStoresHydrated();
  const project = useGraphStore((s) => s.project);
  const viewMode = useGraphStore((s) => s.viewMode);
  const chatOpen = useChatStore((s) => s.open);
  const isMobile = useIsMobile();
  const surface = useWorkspaceStore((s) => s.surface);
  const referenceHandoff = useChatReferenceHandoff((s) => s.pending);
  const tr = useT();
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const canvasMaximized = maximized && Boolean(project) && viewMode === 'graph' && surface === 'planner';

  useEffect(() => { setMaximized(false); }, [project?.id, viewMode, surface]);
  // Explicitly bringing canvas references to chat restores its surrounding UI.
  useEffect(() => { if (referenceHandoff) setMaximized(false); }, [referenceHandoff?.id]);

  useEffect(() => {
    window.addEventListener('keydown', handleAppShortcut);
    return () => window.removeEventListener('keydown', handleAppShortcut);
  }, []);

  // IA indisponível (demo ou sem chave): toast com CTA em vez do alert()
  // nativo. Na demo o CTA volta à entrada do objetivo; sem chave, abre
  // as configurações por cima do projeto.
  useEffect(
    () =>
      setAIUnavailableHandler((err) => {
        toast.show({
          message: err.message,
          tone: 'warn',
          action: isPublicDemo() ? undefined : {
            label: err.reason === 'demo' ? tr.topBar.demoExit : tr.common.configureKey,
            onClick: () => {
              if (err.reason === 'demo') useGraphStore.getState().resetProject();
              else setKeyModalOpen(true);
            },
          },
        });
      }),
    [tr],
  );

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/landing')) {
    return (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    );
  }

  if (!hydrated) return <Splash />;

  let screen;
  if (!project) {
    // As configurações abrem como modal local da ObjectiveScreen, para não
    // desmontar uma geração em andamento.
    screen = <ObjectiveScreen />;
  } else {
    screen = (
      <ReactFlowProvider>
        <div className="h-full w-full flex flex-col overflow-hidden bg-bg-primary">
          <div className="planner-chrome"><TopBar /></div>
          <div className="planner-work-area flex-1 flex min-h-0 min-w-0">
            {viewMode === 'tutor' ? (
              <TutorMode />
            ) : (
              <>
                <GraphCanvas maximized={canvasMaximized} onToggleMaximized={() => setMaximized(value => !value)} />
                <DetailPanel suspended={canvasMaximized || isMobile && chatOpen} />
              </>
            )}
          </div>
          <div className="planner-chrome"><StatusBar /></div>
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <>
      <Workspace planner={screen} canvasMaximized={canvasMaximized} />
      {keyModalOpen && <ApiKeyGate onClose={() => setKeyModalOpen(false)} />}
      {/* No tutor a barra de ações é fixa embaixo: o toast sobe pra não cobri-la. */}
      <Toaster raised={useWorkspaceStore.getState().surface === 'planner' && Boolean(project) && viewMode === 'tutor'} />
    </>
  );
}
