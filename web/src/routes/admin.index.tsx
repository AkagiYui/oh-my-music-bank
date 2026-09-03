import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api, type BucketStatus, type TimeseriesPoint } from '../lib/api';
import { Badge } from '../components/ui/badge';
import { StatCard } from '../components/StatCard';
import { Card, CardContent } from '../components/ui/card';
export const Route = createFileRoute('/admin/')({
  component: Overview,
});
function BarChart(props: { data: TimeseriesPoint[]; field: 'requests' | 'registrations'; color: string }) {
  const w = 640;
  const h = 120;
  const max = () => Math.max(1, ...props.data.map((d) => d[props.field]));
  const bw = () => w / (props.data.length || 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full" preserveAspectRatio="none">
      {(props.data ?? []).map((d, i) => (
        <Fragment key={d.date}>
          {(() => {
            const bh = () => (d[props.field] / max()) * (h - 4);
            return (
              <rect x={i * bw() + 0.5} y={h - bh()} width={Math.max(1, bw() - 1)} height={bh()} fill={props.color}>
                <title>{`${d.date}: ${d[props.field]}`}</title>
              </rect>
            );
          })()}
        </Fragment>
      ))}
    </svg>
  );
}
/** 两套对象存储各自展示一张卡片，凭据不会出现在响应里，只显示 endpoint 与桶名。 */
function BucketCard({ title, desc, status }: { title: string; desc: string; status: BucketStatus | undefined }) {
  const rows: [string, string | undefined][] = [
    ['Endpoint', status?.endpoint],
    ['桶', status?.bucket],
    ['Region', status?.region || '—'],
  ];
  if (status?.kind === 'public') rows.push(['访问前缀', status.baseUrl]);
  if (status?.kind === 'private')
    rows.push([
      '临时地址有效期',
      status.presignTtlSeconds ? `${Math.round(status.presignTtlSeconds / 60)} 分钟` : undefined,
    ]);
  return (
    <Card data-testid={`storage-${status?.kind ?? 'loading'}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
          {status && (
            <Badge variant={status.reachable ? 'outline' : 'destructive'}>{status.reachable ? '可用' : '不可用'}</Badge>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono" title={value}>
                {value ?? '—'}
              </dd>
            </Fragment>
          ))}
        </dl>
        {status?.error && <div className="text-xs text-destructive break-all">{status.error}</div>}
      </CardContent>
    </Card>
  );
}
function Overview() {
  const { data: storage } = useQuery({
    queryKey: ['admin.index:storage'],
    staleTime: 30_000,
    queryFn: () => api.admin.storage.status(),
  });
  const { data: stats } = useQuery({
    queryKey: ['admin.index:stats'],
    staleTime: 30_000,
    queryFn: () => api.admin.stats.overview(),
  });
  const { data: series } = useQuery({
    queryKey: ['admin.index:series'],
    staleTime: 30_000,
    queryFn: () => api.admin.stats.timeseries(30),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">概览</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="用户" value={stats?.users} sub={`今日新增 ${stats?.newUsersToday ?? 0}`} />
        <StatCard label="API Key" value={stats?.apiKeys} />
        <StatCard label="API 调用" value={stats?.totalRequests} sub={`今日 ${stats?.requestsToday ?? 0}`} />
      </div>

      <section aria-labelledby="storage-heading" className="space-y-3">
        <h2 id="storage-heading" className="text-sm font-medium">
          对象存储
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <BucketCard title="公共桶" desc="封面与头像，匿名可读" status={storage?.public} />
          <BucketCard title="私有桶" desc="音频与原始文件，仅限时签名访问" status={storage?.private} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-medium">近 30 天 API 调用量</div>
            {series ? (
              <>
                <BarChart data={series!} field="requests" color="var(--primary)" />
              </>
            ) : (
              <div className="h-28" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-medium">近 30 天注册量</div>
            {series ? (
              <>
                <BarChart data={series!} field="registrations" color="var(--muted-foreground)" />
              </>
            ) : (
              <div className="h-28" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
