import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from '../components/Pagination';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
export const Route = createFileRoute('/admin/api-keys')({
  component: ApiKeysPage,
});
function ApiKeysPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const {
    data: paged,
    isFetching: pagedLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin.api-keys:paged', { term: term, page: page }],
    queryFn: () => api.admin.apiKeys.list(term, page),
  });
  const keys = () => paged?.data;
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">API Key 管理</h1>
      <Card>
        <CardContent className="space-y-4 p-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setTerm(q.trim());
            }}
          >
            <Input
              placeholder="按名称 / 前缀 / 用户名 / 邮箱搜索"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>

          {(keys() ?? []).length > 0 ? (
            <>
              <div className="divide-y rounded-md border">
                {(keys() ?? []).map((k, index) => (
                  <Fragment key={k.id}>
                    <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {k.name || '未命名'} <span className="font-normal text-muted-foreground">· {k.username}</span>
                        </div>
                        <code className="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</code>
                        <span className="ml-2 text-xs text-muted-foreground">最后使用 {fmt(k.lastUsedAt)}</span>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs">
                          每分钟
                          <Input
                            type="number"
                            className="w-20"
                            min="1"
                            max="10000"
                            key={`${k.id}:${k.rpmOverride}`}
                            defaultValue={k.rpmOverride ?? 60}
                            onBlur={async (e) => {
                              if (!e.currentTarget.reportValidity() || !e.currentTarget.value) return;
                              const rpm = Number(e.currentTarget.value);
                              if (rpm === (k.rpmOverride ?? 60)) return;
                              await api.admin.apiKeys.update(k.id, { rpmOverride: rpm });
                              refetch();
                            }}
                          />
                        </label>
                        {k.isRevoked ? (
                          <>
                            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">已撤销</span>
                          </>
                        ) : (
                          <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-600">启用</span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            api.admin.apiKeys.update(k.id, { isRevoked: !k.isRevoked }).then(() => refetch())
                          }
                        >
                          {k.isRevoked ? '恢复' : '撤销'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            confirm('确认删除该 API Key？') && api.admin.apiKeys.remove(k.id).then(() => refetch())
                          }
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
            <p className="text-sm text-muted-foreground">暂无 API Key。</p>
          )}
          <Pagination page={page} total={paged?.total ?? 0} pageSize={50} loading={pagedLoading} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
