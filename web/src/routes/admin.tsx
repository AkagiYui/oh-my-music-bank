import { useEffect, Fragment } from 'react';
import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../stores/auth';
export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});
const NAV: {
  to: string;
  label: string;
  exact?: boolean;
}[] = [
  { to: '/admin', label: '概览', exact: true },
  { to: '/admin/upload', label: '上传音频' },
  { to: '/admin/jobs', label: '收录任务' },
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
  const { ready, isAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && !isAdmin) void navigate({ to: '/' });
  }, [ready, isAdmin, navigate]);
  if (!ready || !isAdmin) return null;
  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <aside className="shrink-0 sm:w-40">
        <nav className="flex gap-0.5 overflow-x-auto text-sm sm:flex-col">
          {(NAV ?? []).map((n, index) => (
            <Fragment key={n.to}>
              <Link
                to={n.to}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{ className: 'bg-accent font-medium text-foreground' }}
                activeOptions={{ exact: n.exact ?? false }}
              >
                {n.label}
              </Link>
            </Fragment>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
