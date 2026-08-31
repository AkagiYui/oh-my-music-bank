import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Pagination } from '../components/Pagination';
export const Route = createFileRoute('/admin/jobs')({ component: JobsPage });
function JobsPage() {
  const [page, setPage] = createSignal(1);
  const [jobs, { refetch }] = createResource(page, api.admin.jobs.list);
  const [busy, setBusy] = createSignal('');
  onMount(() => {
    const timer = setInterval(() => refetch(), 3000);
    onCleanup(() => clearInterval(timer));
  });
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
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">收录任务</h1>
      <p class="text-sm text-muted-foreground">
        下载、解析与响度分析在后台运行。失败任务可重试，上传源文件保留七天；中断任务会自动恢复。
      </p>
      <For each={jobs()?.data ?? []} fallback={<p>暂无任务</p>}>
        {(j) => (
          <div class="space-y-2 rounded border p-3">
            <div class="flex items-center gap-3">
              <span>{j.kind === 'upload' ? '文件上传' : 'B 站导入'}</span>
              <span>
                {j.stage} · {j.progress}%
              </span>
              <span class="ml-auto text-xs">
                {new Date(j.createdAt).toLocaleString()} · 尝试 {j.attempts} 次
              </span>
            </div>
            <progress class="h-2 w-full" max="100" value={j.progress} />
            <Show when={j.trackId}>
              <p class="text-sm">
                曲目 ID：{j.trackId} {j.deduplicated ? '（文件已存在）' : ''}
              </p>
            </Show>
            <Show when={j.errorMessage}>
              <p role="alert" class="text-sm text-destructive">
                {j.errorMessage}
              </p>
            </Show>
            <Show when={['queued', 'processing'].includes(j.status)}>
              <Button size="sm" disabled={busy() === j.id || j.cancelRequested} onClick={() => action(j.id, false)}>
                取消
              </Button>
            </Show>
            <Show when={['failed', 'cancelled'].includes(j.status)}>
              <Button size="sm" disabled={busy() === j.id} onClick={() => action(j.id, true)}>
                重试
              </Button>
            </Show>
          </div>
        )}
      </For>
      <Pagination page={page()} total={jobs()?.total ?? 0} pageSize={20} loading={jobs.loading} onPage={setPage} />
    </div>
  );
}
