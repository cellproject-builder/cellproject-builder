import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedDevKey } from './config/store';
// O CSS do React Flow vem antes: o tema em index.css sobrescreve os padrões dele.
import '@xyflow/react/dist/style.css';
import './index.css';

seedDevKey();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
