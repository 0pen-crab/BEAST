import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app';
import { AuthProvider } from './lib/auth';
import { WorkspaceProvider } from './lib/workspace';
import { ThemeProvider } from './lib/theme';
import { toast } from './lib/toast';
import './lib/i18n';
import './globals.css';

// Every error should scream: surface all query/mutation failures as toasts,
// unless the caller opted out with `meta: { silent: true }`.
function reportError(error: unknown, meta: Record<string, unknown> | undefined) {
  if (meta?.silent) return;
  const message = error instanceof Error ? error.message : String(error);
  // 401s ("Unauthorized" from the API) are a session problem, not a request
  // problem — auth handling deals with those; don't spam a toast per query.
  if (message === 'Unauthorized') return;
  toast.error(message);
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => reportError(error, query.meta),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => reportError(error, mutation.meta),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
