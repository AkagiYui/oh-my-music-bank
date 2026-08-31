import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { api } from '../lib/api';
import { StatCard } from '../components/StatCard';
import { buttonVariants } from '../components/ui/button';

export const Route = createFileRoute('/music/')({
  component: MusicOverview,
});

function MusicOverview() {
  const { data: stats } = useQuery({
    // 沿用统计缓存键，让现有曲目编辑、删除和收录操作继续使概览数据失效。
    queryKey: ['admin.index:stats'],
    staleTime: 30_000,
    queryFn: () => api.admin.stats.overview(),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">曲库概览</h1>
        <p className="text-sm text-muted-foreground">管理曲目、艺术家和专辑，上传或导入音频，并查看后台收录进度。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/music/upload" className={buttonVariants()}>
          上传音频
        </Link>
        <Link to="/music/import" className={buttonVariants({ variant: 'outline' })}>
          哔哩哔哩导入
        </Link>
        <Link to="/music/jobs" className={buttonVariants({ variant: 'outline' })}>
          查看收录任务
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="曲目" value={stats?.tracks} />
        <StatCard label="艺术家" value={stats?.artists} />
        <StatCard label="专辑" value={stats?.albums} />
        <StatCard label="分发音频" value={stats?.audios} />
        <StatCard label="原始音频" value={stats?.originAudios} />
      </div>
    </div>
  );
}
