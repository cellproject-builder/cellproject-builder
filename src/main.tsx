import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isPublicDemo } from './demo/session';
// O CSS do React Flow vem antes: o tema em index.css sobrescreve os padrões dele.
import '@xyflow/react/dist/style.css';
import './index.css';

const root = createRoot(document.getElementById('root')!);

async function start() {
  // Choose the session before importing persisted stores or account bootstrap.
  if (isPublicDemo()) {
    root.render(<main role="status" aria-busy="true" className="p-8">Abrindo demonstração com dados fictícios…</main>);
    const { loadDemoApplication } = await import('./demo/DemoApplication');
    const { default: DemoApplication } = await loadDemoApplication();
    root.render(<StrictMode><DemoApplication /></StrictMode>);
    return;
  }
  const [{ CloudBootstrap }, { registerPwa }] = await Promise.all([import('./cloud/CloudBootstrap'), import('./pwa/install')]);
  void registerPwa(import.meta.env.PROD);
  root.render(<StrictMode>
    <CloudBootstrap loadApplication={async () => {
      const [{ default: App }, { seedDevKey }, { initializeTheme }, { ensureWorkspaceHydrated }] = await Promise.all([import('./App'), import('./config/store'), import('./theme'), import('./workspace/store')]);
      await ensureWorkspaceHydrated();
      seedDevKey(); initializeTheme(); return { default: App };
    }} />
  </StrictMode>);
}

void start().catch(() => root.render(<main role="alert" className="p-8">Não foi possível abrir o aplicativo. Recarregue a página para tentar novamente.</main>));
