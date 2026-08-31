import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { loadSession } from './stores/auth';
import { queryClient } from './lib/query-client';

void loadSession();
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  trailingSlash: 'never',
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
