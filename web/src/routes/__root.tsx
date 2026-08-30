/** 根路由布局：站点头部 + 内容出口。 */
import { Outlet, createRootRoute } from '@tanstack/solid-router';
import { SiteHeader } from '../components/SiteHeader';

export const Route = createRootRoute({
  component: () => (
    <div class="min-h-screen">
      <SiteHeader />
      <main class="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  ),
  notFoundComponent: () => (
    <div class="flex min-h-[40vh] items-center justify-center text-muted-foreground">页面不存在（404）</div>
  ),
});
