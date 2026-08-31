import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

/** 两个管理概览保持一致的指标展示，未加载时不把数量误显示为零。 */
export function StatCard({ label, value, sub }: { label: string; value: number | undefined; sub?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value ?? '—'}</div>
      </CardContent>
    </Card>
  );
}
