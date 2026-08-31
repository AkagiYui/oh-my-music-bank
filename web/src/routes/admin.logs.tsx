import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
export const Route = createFileRoute('/admin/logs')({
  component: LogsPage,
});
function LogsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data: resp } = useQuery({
    queryKey: ['admin.logs:resp', { page: page, status: status }],
    staleTime: 30_000,
    queryFn: () => api.admin.logs.list({ page, statusCode: status ? Number(status) : undefined }),
  });
  const totalPages = () => {
    const r = resp;
    return r ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;
  };
  const statusColor = (s: number) => (s >= 500 ? 'text-destructive' : s >= 400 ? 'text-amber-600' : 'text-green-600');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">调用日志</h1>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Input
              className="w-40"
              type="number"
              placeholder="状态码过滤"
              value={status}
              onChange={(e) => {
                setStatus(e.currentTarget.value);
                setPage(1);
              }}
            />
            <span className="text-sm text-muted-foreground">共 {resp?.total ?? 0} 条</span>
          </div>

          <div className="overflow-x-auto rounded-none border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">时间</th>
                  <th className="p-2 font-medium">路径</th>
                  <th className="p-2 font-medium">状态</th>
                  <th className="p-2 font-medium">耗时</th>
                  <th className="p-2 font-medium">用户 / Key</th>
                  <th className="p-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(resp?.data ?? []).map((l, index) => (
                  <Fragment key={index}>
                    <tr>
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td className="p-2 font-mono text-xs">{l.path}</td>
                      <td className={`p-2 tabular-nums ${statusColor(l.statusCode)}`}>{l.statusCode}</td>
                      <td className="p-2 tabular-nums text-muted-foreground">{l.latencyMs}ms</td>
                      <td className="p-2 text-xs">
                        {l.username || '—'}
                        {l.keyName ? ` / ${l.keyName}` : ''}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{l.clientIp}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {(resp?.data ?? []).length === 0 ? (
            <>
              <p className="text-sm text-muted-foreground">暂无日志。</p>
            </>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span className="text-sm tabular-nums">
              {page} / {totalPages()}
            </span>
            <Button size="sm" variant="outline" disabled={page >= totalPages()} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
