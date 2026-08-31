import { Link, useNavigate } from '@tanstack/react-router';
import { BrandLogo, useSiteConfig } from './SiteBranding';
import { logout, useAuth } from '../stores/auth';
import { Button } from './ui/button';
function NavLink(props: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={props.to}
      className="rounded-none px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
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
  const site = useSiteConfig();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
        <Link to="/" className="mr-2 flex min-w-0 items-center gap-2 font-semibold" title={site.systemTitle}>
          <BrandLogo url={site.logoUrl} />
          <span className="max-w-64 truncate">{site.systemTitle}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink to="/">首页</NavLink>
          <NavLink to="/search">试搜</NavLink>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          {user ? (
            <>
              {isAdmin ? (
                <>
                  <NavLink to="/music">曲库管理</NavLink>
                  <NavLink to="/admin">系统管理</NavLink>
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
                  void navigate({ to: '/' });
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
              {site.registrationEnabled && (
                <Button size="sm" onClick={() => navigate({ to: '/register' })}>
                  注册
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
