import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedDevKey } from './config/store';
import './index.css';
import '@xyflow/react/dist/style.css';

seedDevKey();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
