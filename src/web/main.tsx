import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { hydrate } from './lib/query.ts';
import { startSync } from './lib/sync.ts';
import './fonts.ts';
import './styles.css';

startSync();
// The last data from earlier sessions first, but never wait long for it.
void Promise.race([hydrate(), new Promise((resolve) => setTimeout(resolve, 1000))]).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
