import { Show, createResource, type JSX } from 'solid-js';
import { Link, useNavigate } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { isAdmin, logout, user } from '../stores/auth';
import { Button } from './ui/button';

function NavLink(props: { to: string; children: JSX.Element }) {
  return (
    <Link
      to={props.to}
      class="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      activeProps={{ class: 'text-foreground font-medium' }}
      activeOptions={{ exact: props.to === '/' }}
    >
      {props.children}
    </Link>
  );
}

/** 站点头部：品牌、导航与登录态操作。 */
export function SiteHeader() {
  const navigate = useNavigate();
  const [site] = createResource(() => api.site().catch(() => ({ brandName: 'Oh My Music Bank' })));

  return (
    <header class="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <Link to="/" class="mr-2 flex items-center gap-2 font-semibold">
          <span class="text-primary">♪</span>
          {site()?.brandName ?? 'Oh My Music Bank'}
        </Link>
        <nav class="flex items-center gap-1 text-sm">
          <NavLink to="/">首页</NavLink>
          <NavLink to="/search">试搜</NavLink>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <Show
            when={user()}
            fallback={
              <>
                <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/login' })}>
                  登录
                </Button>
                <Button size="sm" onClick={() => navigate({ to: '/register' })}>
                  注册
                </Button>
              </>
            }
          >
            <Show when={isAdmin()}>
              <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/admin' })}>
                管理
              </Button>
            </Show>
            <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/dashboard' })}>
              控制台
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                logout();
                navigate({ to: '/' });
              }}
            >
              退出
            </Button>
          </Show>
        </div>
      </div>
    </header>
  );
}
