import App from '@/App';
import { initializeTheme } from '@/theme';
import { ensureWorkspaceHydrated, useWorkspaceStore } from '@/workspace/store';
import { useGraphStore } from '@/store';
import { useConfigStore } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { useChatStore } from '@/chat/store';
import { useKBStore } from '@/kb/store';
import { seedPublicDemo } from './seed';
import { isPublicDemo } from './session';
import { AsciiWorkshop } from '@/workspace/AsciiWorkshop';
import { useSidebarStore } from '@/workspace/sidebarPreference';
import './demo.css';

let ready: Promise<{ default: typeof DemoApplication }> | undefined;
export function loadDemoApplication() {
  if (!isPublicDemo()) throw new Error('A demonstração só pode ser iniciada pelo link /demo.');
  ready ??= (async () => {
    await ensureWorkspaceHydrated();
    const stores = [useGraphStore, useConfigStore, useLocaleStore, useWorkspaceStore, useChatStore, useKBStore];
    await Promise.all(stores.map(store => store.persist.hasHydrated() ? undefined : new Promise<void>(resolve => {
      const unsubscribe = store.persist.onFinishHydration(() => { unsubscribe(); resolve(); });
      if (store.persist.hasHydrated()) { unsubscribe(); resolve(); }
    })));
    initializeTheme();
    document.title = 'Demonstração · Cellproject';
    await seedPublicDemo();
    useSidebarStore.getState().setCollapsed(true);
    return { default: DemoApplication };
  })();
  return ready;
}

export function DemoApplication() {
  const surface = useWorkspaceStore(state => state.surface);
  return <div className="demo-session">
    <header className="demo-banner" aria-label="Modo de demonstração">
      <div><strong><span aria-hidden="true" className="demo-dot"/>Demonstração</strong><span>Dados fictícios; alterações não são salvas. Recarregue para recomeçar.</span></div>
      <button type="button" onClick={() => window.location.reload()} title="Descartar as alterações desta demonstração e voltar aos exemplos">Recomeçar demo<span aria-hidden="true"> ↻</span></button>
    </header>
    <div className="demo-content"><App /></div>
    {surface === 'projects' && <div className="demo-project-workshop"><AsciiWorkshop interest={null} /></div>}
  </div>;
}
