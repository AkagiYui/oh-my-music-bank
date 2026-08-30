/** 路由 `/admin` —— 管理后台布局：侧边导航 + 子页面出口（仅管理员）。 */
import { For, createEffect } from 'solid-js';
import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { isAdmin, ready } from '../stores/auth';

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});

const NAV: { to: string; label: string; exact?: boolean }[] = [
  { to: '/admin', label: '概览', exact: true },
  { to: '/admin/upload', label: '上传音频' },
  { to: '/admin/import', label: '哔哩哔哩导入' },
  { to: '/admin/tracks', label: '曲目' },
  { to: '/admin/artists', label: '艺术家' },
  { to: '/admin/albums', label: '专辑' },
  { to: '/admin/api-keys', label: 'API Key' },
  { to: '/admin/logs', label: '调用日志' },
  { to: '/admin/users', label: '用户' },
  { to: '/admin/settings', label: '站点设置' },
  { to: '/admin/integrations', label: '集成' },
];

function AdminLayout() {
  const navigate = useNavigate();
  createEffect(() => {
    if (ready() && !isAdmin()) navigate({ to: '/' });
  });

  return (
    <div class="flex flex-col gap-6 sm:flex-row">
      <aside class="shrink-0 sm:w-40">
        <nav class="flex gap-0.5 overflow-x-auto text-sm sm:flex-col">
          <For each={NAV}>
            {(n) => (
              <Link
                to={n.to}
                class="whitespace-nowrap rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{ class: 'bg-accent font-medium text-foreground' }}
                activeOptions={{ exact: n.exact ?? false }}
              >
                {n.label}
              </Link>
            )}
          </For>
        </nav>
      </aside>
      <div class="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
