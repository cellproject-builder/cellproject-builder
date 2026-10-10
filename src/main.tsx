import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CloudBootstrap } from './cloud/CloudBootstrap';
import { registerPwa } from './pwa/install';
// O CSS do React Flow vem antes: o tema em index.css sobrescreve os padrões dele.
import '@xyflow/react/dist/style.css';
import './index.css';

void registerPwa(import.meta.env.PROD);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CloudBootstrap loadApplication={async () => {
      const [{ default: App }, { seedDevKey }, { initializeTheme }] = await Promise.all([import('./App'), import('./config/store'), import('./theme')]);
      seedDevKey(); initializeTheme(); return { default: App };
    }} />
  </StrictMode>,
);
