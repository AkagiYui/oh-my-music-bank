/** 路由 `/admin/users` —— 用户管理。 */
import { For, Show, createResource } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

export const Route = createFileRoute('/admin/users')({
  component: UsersPage,
});

function UsersPage() {
  const [users, { refetch }] = createResource(() => api.admin.users.list().then((r) => r.data));

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">用户管理</h1>
      <Card>
        <CardContent class="p-4">
          <Show when={(users() ?? []).length > 0} fallback={<p class="text-sm text-muted-foreground">加载中…</p>}>
            <div class="divide-y rounded-md border">
              <For each={users()}>
                {(u) => (
                  <div class="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <div class="min-w-0">
                      <div class="truncate font-medium">{u.username}</div>
                      <div class="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    <div class="ml-auto flex items-center gap-2">
                      <select
                        class="h-9 rounded-md border border-input bg-background px-2 text-xs"
                        value={u.role}
                        onChange={(e) => api.admin.users.setRole(u.id, e.currentTarget.value).then(refetch)}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => api.admin.users.toggleActive(u.id, !u.isActive).then(refetch)}>
                        {u.isActive ? '禁用' : '启用'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirm('确认删除该用户？') && api.admin.users.remove(u.id).then(refetch)}
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
