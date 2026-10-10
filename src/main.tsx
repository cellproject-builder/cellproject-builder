import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedDevKey } from './config/store';
import { initializeTheme } from './theme';
import { registerPwa } from './pwa/install';
// O CSS do React Flow vem antes: o tema em index.css sobrescreve os padrões dele.
import '@xyflow/react/dist/style.css';
import './index.css';

initializeTheme();
seedDevKey();
void registerPwa(import.meta.env.PROD);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
