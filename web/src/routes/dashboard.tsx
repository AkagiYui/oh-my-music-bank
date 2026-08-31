import { useEffect, useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from '../components/Pagination';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { api, ApiError } from '../lib/api';
import { loadSession, useAuth } from '../stores/auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});
function Dashboard() {
  const { user, ready, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && !isAuthenticated) void navigate({ to: '/login' });
  }, [ready, isAuthenticated, navigate]);
  const [page, setPage] = useState(1);
  const {
    data: paged,
    isFetching: pagedLoading,
    refetch,
  } = useQuery({
    queryKey: ['dashboard:paged', page],
    enabled: ready && isAuthenticated,
    queryFn: () => api.apiKeys.list(page),
  });
  const keys = () => paged?.data;
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.apiKeys.create({ name: name.trim() || '未命名' });
      setCreated(res.key);
      setName('');
      void refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  if (!ready || !isAuthenticated) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">控制台</h1>
        <p className="text-sm text-muted-foreground">你好，{user?.username} —— 在这里管理你的 API Key。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>新建 API Key</CardTitle>
          <CardDescription>明文仅在创建时展示一次，请妥善保存。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex gap-2" onSubmit={create}>
            <Input placeholder="名称（如 我的应用）" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Button type="submit" disabled={busy}>
              创建
            </Button>
          </form>
          {error ? (
            <>
              <p className="text-sm text-destructive">{error}</p>
            </>
          ) : null}
          {created ? (
            <>
              <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                <div className="text-sm font-medium">已创建，请立即复制（仅此一次可见）：</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-auto rounded bg-muted px-2 py-1 font-mono text-xs">{created}</code>
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(created ?? '')}>
                    复制
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                    知道了
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>我的 API Key</CardTitle>
        </CardHeader>
        <CardContent>
          {(keys() ?? []).length > 0 ? (
            <>
              <div className="divide-y rounded-md border">
                {(keys() ?? []).map((k, index) => (
                  <Fragment key={k.id}>
                    <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium">{k.name || '未命名'}</div>
                        <code className="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</code>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {k.isRevoked ? (
                          <>
                            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">已撤销</span>
                          </>
                        ) : (
                          <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-600">启用</span>
                        )}
                        {!k.isRevoked ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => api.apiKeys.revoke(k.id).then(() => refetch())}
                            >
                              撤销
                            </Button>
                          </>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => api.apiKeys.remove(k.id).then(() => refetch())}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">还没有 API Key。</p>
          )}
          <Pagination page={page} total={paged?.total ?? 0} pageSize={20} loading={pagedLoading} onPage={setPage} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>账号设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.profile.email(email);
              void loadSession();
              setProfileMessage('邮箱已更新');
            }}
          >
            <Input
              type="email"
              required
              placeholder={user?.email ?? '新邮箱'}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Button type="submit">修改邮箱</Button>
          </form>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.profile.password(currentPassword, newPassword);
              window.dispatchEvent(new Event('ommb:session-expired'));
              void navigate({ to: '/login' });
            }}
          >
            <Input
              type="password"
              required
              autoComplete="current-password"
              placeholder="当前密码"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            />
            <Input
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="新密码（修改后所有会话退出）"
              value={newPassword}
              onChange={(e) => setNewPassword(e.currentTarget.value)}
            />
            <Button type="submit">修改密码</Button>
          </form>
          {profileMessage ? (
            <>
              <p role="status">{profileMessage}</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
