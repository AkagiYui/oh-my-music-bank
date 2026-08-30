/** 路由 `/admin/api-keys` —— 全站 API Key 管理。 */
import { For, Show, createResource, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';

export const Route = createFileRoute('/admin/api-keys')({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const [q, setQ] = createSignal('');
  const [term, setTerm] = createSignal('');
  const [keys, { refetch }] = createResource(term, (t) => api.admin.apiKeys.list(t).then((r) => r.data));

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">API Key 管理</h1>
      <Card>
        <CardContent class="space-y-4 p-4">
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q().trim());
            }}
          >
            <Input placeholder="按名称 / 前缀 / 用户名 / 邮箱搜索" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>

          <Show when={(keys() ?? []).length > 0} fallback={<p class="text-sm text-muted-foreground">暂无 API Key。</p>}>
            <div class="divide-y rounded-md border">
              <For each={keys()}>
                {(k) => (
                  <div class="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <div class="min-w-0">
                      <div class="truncate font-medium">
                        {k.name || '未命名'} <span class="font-normal text-muted-foreground">· {k.username}</span>
                      </div>
                      <code class="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</code>
                      <span class="ml-2 text-xs text-muted-foreground">最后使用 {fmt(k.lastUsedAt)}</span>
                    </div>
                    <div class="ml-auto flex items-center gap-2">
                      <Show
                        when={k.isRevoked}
                        fallback={<span class="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-600">启用</span>}
                      >
                        <span class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">已撤销</span>
                      </Show>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => api.admin.apiKeys.update(k.id, { isRevoked: !k.isRevoked }).then(refetch)}
                      >
                        {k.isRevoked ? '恢复' : '撤销'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirm('确认删除该 API Key？') && api.admin.apiKeys.remove(k.id).then(refetch)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}
