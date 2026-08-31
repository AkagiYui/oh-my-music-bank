import { useEffect } from 'react';
import { Link, Outlet, useNavigate, type LinkProps } from '@tanstack/react-router';
import { useAuth } from '../stores/auth';

export type ManagementNavItem = {
  to: NonNullable<LinkProps['to']>;
  label: string;
  exact?: boolean;
};

/** 曲库与系统管理共享权限检查，会话确认前不挂载子页面或请求管理数据。 */
export function ManagementLayout({ title, items }: { title: string; items: ManagementNavItem[] }) {
  const { ready, isAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && !isAdmin) void navigate({ to: '/', replace: true });
  }, [ready, isAdmin, navigate]);
  if (!ready || !isAdmin) return null;

  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row">
      <aside className="min-w-0 shrink-0 sm:w-40">
        <p className="mb-3 px-3 text-sm font-semibold">{title}</p>
        <nav aria-label={title} className="flex gap-0.5 overflow-x-auto text-sm sm:flex-col">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="whitespace-nowrap rounded-none px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: 'bg-accent font-medium text-foreground' }}
              activeOptions={{ exact: item.exact ?? false }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
