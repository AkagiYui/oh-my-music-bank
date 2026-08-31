import { Pagination } from '../components/Pagination';
/** 路由 `/dashboard` —— 用户控制台：管理自己的 API Key。 */
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { createFileRoute, useNavigate } from '@tanstack/solid-router';
import { api, ApiError } from '../lib/api';
import { isAuthenticated, ready, user, loadSession } from '../stores/auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  createEffect(() => {
    if (ready() && !isAuthenticated()) navigate({ to: '/login' });
  });

  const [page, setPage] = createSignal(1);
  const [paged, { refetch }] = createResource(page, (p) => api.apiKeys.list(p));
  const keys = () => paged()?.data;
  const [name, setName] = createSignal('');
  const [created, setCreated] = createSignal<string | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [email, setEmail] = createSignal('');
  const [currentPassword, setCurrentPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [profileMessage, setProfileMessage] = createSignal('');

  async function create(e: Event) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.apiKeys.create({ name: name().trim() || '未命名' });
      setCreated(res.key);
      setName('');
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-semibold">控制台</h1>
        <p class="text-sm text-muted-foreground">你好，{user()?.username} —— 在这里管理你的 API Key。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>新建 API Key</CardTitle>
          <CardDescription>明文仅在创建时展示一次，请妥善保存。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <form class="flex gap-2" onSubmit={create}>
            <Input placeholder="名称（如 我的应用）" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            <Button type="submit" disabled={busy()}>
              创建
            </Button>
          </form>
          <Show when={error()}>
            <p class="text-sm text-destructive">{error()}</p>
          </Show>
          <Show when={created()}>
            <div class="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <div class="text-sm font-medium">已创建，请立即复制（仅此一次可见）：</div>
              <div class="flex items-center gap-2">
                <code class="flex-1 overflow-auto rounded bg-muted px-2 py-1 font-mono text-xs">{created()}</code>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(created() ?? '')}>
                  复制
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  知道了
                </Button>
              </div>
            </div>
          </Show>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>我的 API Key</CardTitle>
        </CardHeader>
        <CardContent>
          <Show
            when={(keys() ?? []).length > 0}
            fallback={<p class="text-sm text-muted-foreground">还没有 API Key。</p>}
          >
            <div class="divide-y rounded-md border">
              <For each={keys()}>
                {(k) => (
                  <div class="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <div class="min-w-0">
                      <div class="font-medium">{k.name || '未命名'}</div>
                      <code class="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</code>
                    </div>
                    <div class="ml-auto flex items-center gap-2">
                      <Show
                        when={k.isRevoked}
                        fallback={<span class="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-600">启用</span>}
                      >
                        <span class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">已撤销</span>
                      </Show>
                      <Show when={!k.isRevoked}>
                        <Button size="sm" variant="ghost" onClick={() => api.apiKeys.revoke(k.id).then(refetch)}>
                          撤销
                        </Button>
                      </Show>
                      <Button size="sm" variant="ghost" onClick={() => api.apiKeys.remove(k.id).then(refetch)}>
                        删除
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Pagination
            page={page()}
            total={paged()?.total ?? 0}
            pageSize={20}
            loading={paged.loading}
            onPage={setPage}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>账号设置</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <form
            class="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.profile.email(email());
              loadSession();
              setProfileMessage('邮箱已更新');
            }}
          >
            <Input
              type="email"
              required
              placeholder={user()?.email ?? '新邮箱'}
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
            <Button>修改邮箱</Button>
          </form>
          <form
            class="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.profile.password(currentPassword(), newPassword());
              window.dispatchEvent(new Event('ommb:session-expired'));
              navigate({ to: '/login' });
            }}
          >
            <Input
              type="password"
              required
              autocomplete="current-password"
              placeholder="当前密码"
              value={currentPassword()}
              onInput={(e) => setCurrentPassword(e.currentTarget.value)}
            />
            <Input
              type="password"
              required
              minlength={8}
              maxlength={72}
              autocomplete="new-password"
              placeholder="新密码（修改后所有会话退出）"
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
            />
            <Button>修改密码</Button>
          </form>
          <Show when={profileMessage()}>
            <p role="status">{profileMessage()}</p>
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}
