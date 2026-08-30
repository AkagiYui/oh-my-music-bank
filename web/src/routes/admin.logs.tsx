/** 路由 `/admin/logs` —— API 调用日志。 */
import { For, Show, createResource, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';

export const Route = createFileRoute('/admin/logs')({
  component: LogsPage,
});

function LogsPage() {
  const [page, setPage] = createSignal(1);
  const [status, setStatus] = createSignal('');
  const [resp] = createResource(
    () => ({ page: page(), status: status() }),
    (p) => api.admin.logs.list({ page: p.page, statusCode: p.status ? Number(p.status) : undefined }),
  );

  const totalPages = () => {
    const r = resp();
    return r ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;
  };

  const statusColor = (s: number) =>
    s >= 500 ? 'text-destructive' : s >= 400 ? 'text-amber-600' : 'text-green-600';

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">调用日志</h1>
      <Card>
        <CardContent class="space-y-4 p-4">
          <div class="flex items-center gap-2">
            <Input
              class="w-40"
              type="number"
              placeholder="状态码过滤"
              value={status()}
              onInput={(e) => {
                setStatus(e.currentTarget.value);
                setPage(1);
              }}
            />
            <span class="text-sm text-muted-foreground">共 {resp()?.total ?? 0} 条</span>
          </div>

          <div class="overflow-x-auto rounded-md border">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th class="p-2 font-medium">时间</th>
                  <th class="p-2 font-medium">路径</th>
                  <th class="p-2 font-medium">状态</th>
                  <th class="p-2 font-medium">耗时</th>
                  <th class="p-2 font-medium">用户 / Key</th>
                  <th class="p-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <For each={resp()?.data ?? []}>
                  {(l) => (
                    <tr>
                      <td class="whitespace-nowrap p-2 text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</td>
                      <td class="p-2 font-mono text-xs">{l.path}</td>
                      <td class={`p-2 tabular-nums ${statusColor(l.statusCode)}`}>{l.statusCode}</td>
                      <td class="p-2 tabular-nums text-muted-foreground">{l.latencyMs}ms</td>
                      <td class="p-2 text-xs">{l.username || '—'}{l.keyName ? ` / ${l.keyName}` : ''}</td>
                      <td class="p-2 text-xs text-muted-foreground">{l.clientIp}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>

          <Show when={(resp()?.data ?? []).length === 0}>
            <p class="text-sm text-muted-foreground">暂无日志。</p>
          </Show>

          <div class="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={page() <= 1} onClick={() => setPage(page() - 1)}>
              上一页
            </Button>
            <span class="text-sm tabular-nums">
              {page()} / {totalPages()}
            </span>
            <Button size="sm" variant="outline" disabled={page() >= totalPages()} onClick={() => setPage(page() + 1)}>
              下一页
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
