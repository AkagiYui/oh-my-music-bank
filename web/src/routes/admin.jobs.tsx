import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Pagination } from '../components/Pagination';
export const Route = createFileRoute('/admin/jobs')({ component: JobsPage });
function JobsPage() {
  const [page, setPage] = useState(1);
  const {
    data: jobs,
    isFetching: jobsLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin.jobs:jobs', page],
    refetchInterval: 3000,
    queryFn: () => api.admin.jobs.list(page),
  });
  const [busy, setBusy] = useState('');
  async function action(id: string, retry: boolean) {
    setBusy(id);
    try {
      await (retry ? api.admin.jobs.retry(id) : api.admin.jobs.cancel(id));
      await refetch();
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">收录任务</h1>
      <p className="text-sm text-muted-foreground">
        下载、解析与响度分析在后台运行。失败任务可重试，上传源文件保留七天；中断任务会自动恢复。
      </p>
      {(jobs?.data ?? []).length ? (
        (jobs?.data ?? []).map((j, index) => (
          <Fragment key={j.id}>
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center gap-3">
                <span>{j.kind === 'upload' ? '文件上传' : 'B 站导入'}</span>
                <Badge variant={j.status === 'failed' ? 'destructive' : 'secondary'}>
                  {j.stage} · {j.progress}%
                </Badge>
                <span className="ml-auto text-xs">
                  {new Date(j.createdAt).toLocaleString()} · 尝试 {j.attempts} 次
                </span>
              </div>
              <Progress aria-label="收录进度" value={j.progress} />
              {j.trackId ? (
                <>
                  <p className="text-sm">
                    曲目 ID：{j.trackId} {j.deduplicated ? '（文件已存在）' : ''}
                  </p>
                </>
              ) : null}
              {j.errorMessage ? (
                <>
                  <p role="alert" className="text-sm text-destructive">
                    {j.errorMessage}
                  </p>
                </>
              ) : null}
              {['queued', 'processing'].includes(j.status) ? (
                <>
                  <Button size="sm" disabled={busy === j.id || j.cancelRequested} onClick={() => action(j.id, false)}>
                    取消
                  </Button>
                </>
              ) : null}
              {['failed', 'cancelled'].includes(j.status) ? (
                <>
                  <Button size="sm" disabled={busy === j.id} onClick={() => action(j.id, true)}>
                    重试
                  </Button>
                </>
              ) : null}
            </div>
          </Fragment>
        ))
      ) : (
        <p>暂无任务</p>
      )}
      <Pagination page={page} total={jobs?.total ?? 0} pageSize={20} loading={jobsLoading} onPage={setPage} />
    </div>
  );
}
