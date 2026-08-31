import { Outlet, createRootRoute, useRouter } from '@tanstack/react-router';
import { Feedback } from '../components/Feedback';
import { SiteProvider, SiteMetadata, SiteFooter } from '../components/SiteBranding';
import { SiteHeader } from '../components/SiteHeader';
import { Button } from '../components/ui/button';

function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div role="alert" className="space-y-3 p-6">
      <p>页面加载失败：{error.message}</p>
      <Button
        onClick={() => {
          void router.invalidate();
          reset();
        }}
      >
        重试
      </Button>
    </div>
  );
}
export const Route = createRootRoute({
  component: () => (
    <SiteProvider>
      <div className="flex min-h-screen flex-col">
        <SiteMetadata />
        <SiteHeader />
        <Feedback />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </SiteProvider>
  ),
  errorComponent: RouteError,
  notFoundComponent: () => (
    <div className="flex min-h-80 items-center justify-center text-muted-foreground">页面不存在（404）</div>
  ),
});
