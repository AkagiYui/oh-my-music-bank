import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { api } from '../lib/api';
import { logout, useAuth } from '../stores/auth';
import { Button } from './ui/button';
function NavLink(props: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={props.to}
      className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      activeProps={{ className: 'text-foreground font-medium' }}
      activeOptions={{ exact: props.to === '/' }}
    >
      {props.children}
    </Link>
  );
}
/** 站点头部：品牌、导航与登录态操作。 */
export function SiteHeader() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { data: site } = useQuery({
    queryKey: ['SiteHeader:site'],
    queryFn: () => api.site().catch(() => ({ brandName: 'Oh My Music Bank' })),
  });
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
        <Link to="/" className="mr-2 flex items-center gap-2 font-semibold">
          <span className="text-primary">♪</span>
          {site?.brandName ?? 'Oh My Music Bank'}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink to="/">首页</NavLink>
          <NavLink to="/search">试搜</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              {isAdmin ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/admin' })}>
                    管理
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/dashboard' })}>
                控制台
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await logout();
                  navigate({ to: '/' });
                }}
              >
                退出
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/login' })}>
                登录
              </Button>
              <Button size="sm" onClick={() => navigate({ to: '/register' })}>
                注册
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
