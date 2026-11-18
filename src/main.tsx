import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './index.css';

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {setUnauthenticatedHandler} from './api/client';
import {App} from './App';
import {USE_MOCKS} from './lib/env';

const queryClient = new QueryClient({
  defaultOptions: {queries: {retry: 1, refetchOnWindowFocus: false}},
});

// When any request finds the session gone, forget the cached user; the route guard
// then sends the visitor to the login page and brings them back afterwards.
setUnauthenticatedHandler(() => queryClient.setQueryData<unknown>(['me'], null));

async function start() {
  if (USE_MOCKS) {
    // The mock API answers /api/v1 requests in the browser until the real backend exists.
    const {worker} = await import('./mocks/browser');
    await worker.start({onUnhandledRequest: 'bypass', quiet: true});
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
