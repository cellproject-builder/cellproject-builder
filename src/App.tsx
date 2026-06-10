import { useEffect, lazy, Suspense } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore, isDemoProject } from '@/store';
import { useConfigStore } from '@/config/store';
import { ObjectiveScreen } from '@/components/ObjectiveScreen';
import { TopBar } from '@/components/TopBar';
import { StatusBar } from '@/components/StatusBar';
import { GraphCanvas } from '@/components/GraphCanvas';
import { DetailPanel } from '@/components/DetailPanel';
import { TutorMode } from '@/components/TutorMode';
import { ApiKeyGate } from '@/components/ApiKeyGate';
// Route-split: the marketing page is only shown on /landing, so app users
// never download it and /landing visitors don't pull the whole app.
const LandingPage = lazy(() =>
  import('@/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
);

export default function App() {
  const project = useGraphStore((s) => s.project);
  const viewMode = useGraphStore((s) => s.viewMode);
  const setLens = useGraphStore((s) => s.setLens);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const providers = useConfigStore((s) => s.providers);
  const hasKey = activeProvider ? Boolean(providers[activeProvider]?.apiKey) : false;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      // Superfície modal aberta (modo leitura, sheet mobile): atalhos de uma
      // letra trocariam a view e desmontariam o overlay no meio da leitura.
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 't') setViewMode('tutor');
      else if (e.key === 'g') setViewMode('graph');
      else if (e.key === '1') setLens('structure');
      else if (e.key === '2') setLens('flow');
      else if (e.key === '3') setLens('risk');
      else if (e.key === '4') setLens('state');
      else if (e.key === '5') setLens('connections');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setLens, setViewMode]);

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/landing')) {
    return (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    );
  }

  // Demo projects bypass the API key gate — user explicitly chose "try without a key".
  // AI actions are blocked separately at the call sites.
  const inDemo = isDemoProject(project);

  if (!hasKey && !inDemo) {
    return <ApiKeyGate />;
  }

  if (!project) {
    return <ObjectiveScreen />;
  }

  return (
    <ReactFlowProvider>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-bg-primary">
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
