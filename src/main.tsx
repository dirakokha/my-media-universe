import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './index.css';
import { hydrateCacheFromLocal, startCachePersistence } from './lib/query';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

// Hydrate the IndexedDB cache BEFORE the first render so an offline launch shows
// the last known session and library instead of bouncing to the login page.
void (async () => {
  await hydrateCacheFromLocal();
  startCachePersistence();

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
