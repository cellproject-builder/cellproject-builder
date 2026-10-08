import { useEffect, useState, lazy, Suspense } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore, isDemoProject } from '@/store';
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
import { Logo } from '@/components/Logo';
import { Toaster, toast } from '@/components/ui/Toast';
// Route-split: the marketing page is only shown on /landing, so app users
// never download it and /landing visitors don't pull the whole app.
const LandingPage = lazy(() =>
  import('@/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
);

// Os stores persistidos hidratam do IndexedDB de forma assíncrona. Antes disso
// `providers` está vazio e o app piscaria o ApiKeyGate para quem já tem chave.
const persistedStores = [useGraphStore, useConfigStore, useLocaleStore] as const;

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

// Atalhos de uma letra só valem fora de campos editáveis, sem modificadores e
// sem diálogo aberto (modo leitura, sheet mobile, modais).
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
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
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>,
): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
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
      <Logo size={28} className="text-text-muted animate-pulse-subtle" />
    </div>
  );
}

export default function App() {
  const hydrated = useStoresHydrated();
  const project = useGraphStore((s) => s.project);
  const viewMode = useGraphStore((s) => s.viewMode);
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const providers = useConfigStore((s) => s.providers);
  const hasKey = activeProvider ? Boolean(providers[activeProvider]?.apiKey) : false;
  const tr = useT();
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  useEffect(() => {
    window.addEventListener('keydown', handleAppShortcut);
    return () => window.removeEventListener('keydown', handleAppShortcut);
  }, []);

  // IA indisponível (demo ou sem chave): toast com CTA em vez do alert()
  // nativo. Na demo o CTA sai dela (cai na tela de chave); sem chave, abre
  // as configurações por cima do projeto.
  useEffect(
    () =>
      setAIUnavailableHandler((err) => {
        toast.show({
          message: err.message,
          tone: 'warn',
          action: {
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

  // Demo projects bypass the API key gate — user explicitly chose "try without a key".
  // AI actions are blocked separately at the call sites.
  const inDemo = isDemoProject(project);

  let screen;
  if (!hasKey && !inDemo) {
    screen = <ApiKeyGate />;
  } else if (!project) {
    // As configurações abrem como modal local da ObjectiveScreen, para não
    // desmontar uma geração em andamento.
    screen = <ObjectiveScreen />;
  } else {
    screen = (
      <ReactFlowProvider>
        <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-bg-primary">
          <TopBar />
          <div className="flex-1 flex min-h-0">
            {viewMode === 'tutor' ? (
              <TutorMode />
            ) : (
              <>
                <GraphCanvas />
                <DetailPanel />
              </>
            )}
          </div>
          <StatusBar />
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <>
      {screen}
      {keyModalOpen && <ApiKeyGate onClose={() => setKeyModalOpen(false)} />}
      {/* No tutor a barra de ações é fixa embaixo: o toast sobe pra não cobri-la. */}
      <Toaster raised={Boolean(project) && viewMode === 'tutor'} />
    </>
  );
}
