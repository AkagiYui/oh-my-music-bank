/** 应用入口：TanStack Router（文件式路由 + history 模式），纯 SPA。 */
import './app.css';
import { render } from 'solid-js/web';
import { RouterProvider, createRouter } from '@tanstack/solid-router';
import { routeTree } from './routeTree.gen';
import { loadSession } from './stores/auth';

// 启动前从 localStorage 恢复登录态。
loadSession();

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  trailingSlash: 'never',
});

declare module '@tanstack/solid-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root) {
  render(() => <RouterProvider router={router} />, root);
}
