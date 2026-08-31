import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api, type TimeseriesPoint } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
export const Route = createFileRoute('/admin/')({
  component: Overview,
});
function StatCard(props: { label: string; value: number | undefined; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{props.label}</div>
        <div className="text-2xl font-semibold tabular-nums">{props.value ?? '—'}</div>
        {props.sub ? (
          <>
            <div className="text-xs text-muted-foreground">{props.sub}</div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
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
function Overview() {
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="用户" value={stats?.users} sub={`今日新增 ${stats?.newUsersToday ?? 0}`} />
        <StatCard label="曲目" value={stats?.tracks} />
        <StatCard label="艺术家" value={stats?.artists} />
        <StatCard label="专辑" value={stats?.albums} />
        <StatCard label="分发音频" value={stats?.audios} />
        <StatCard label="原始音频" value={stats?.originAudios} />
        <StatCard label="API Key" value={stats?.apiKeys} />
        <StatCard label="API 调用" value={stats?.totalRequests} sub={`今日 ${stats?.requestsToday ?? 0}`} />
      </div>

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
