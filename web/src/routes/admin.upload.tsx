import { For, Show, createSignal } from 'solid-js';
import { createFileRoute, Link } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
export const Route = createFileRoute('/admin/upload')({
  component: UploadPage,
});
function UploadPage() {
  const [files, setFiles] = createSignal<File[]>([]);
  const [title, setTitle] = createSignal('');
  const [artist, setArtist] = createSignal('');
  const [target, setTarget] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [messages, setMessages] = createSignal<string[]>([]);
  let input!: HTMLInputElement;
  async function submit(e: Event) {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setMessages([]);
    const failed: File[] = [];
    // 按文件独立提交，单个失败不会阻断其余文件；失败项保留以便再次提交。
    try {
      for (const file of files()) {
        try {
          const j = await api.admin.jobs.upload(file, {
            title: title().trim(),
            artist: artist().trim(),
            trackId: target().trim(),
          });
          setMessages((m) => [...m, `${file.name}：已进入任务 ${j.id}`]);
        } catch (err) {
          failed.push(file);
          setMessages((m) => [...m, `${file.name}：${String(err)}`]);
        }
      }
    } finally {
      setFiles(failed);
      if (!failed.length) input.value = '';
      setBusy(false);
    }
  }
  return (
    <div class="max-w-2xl space-y-4">
      <h1 class="text-2xl font-semibold">批量上传音频</h1>
      <form onSubmit={submit} class="space-y-3 rounded border p-4">
        <Input
          ref={input}
          type="file"
          multiple
          accept="audio/*,.ape,.aiff"
          disabled={busy()}
          onChange={(e) => setFiles(Array.from(e.currentTarget.files ?? []))}
        />
        <p class="text-sm">已选择 {files().length} 个文件。留空标题和艺术家时使用文件标签。</p>
        <Input
          placeholder="标题（可选）"
          value={title()}
          disabled={busy()}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
        <Input
          placeholder="艺术家（可选）"
          value={artist()}
          disabled={busy()}
          onInput={(e) => setArtist(e.currentTarget.value)}
        />
        <Input
          placeholder="已有曲目 ID（可选，将文件加入该曲目的来源/音质版本）"
          value={target()}
          disabled={busy()}
          onInput={(e) => setTarget(e.currentTarget.value)}
        />
        <Button disabled={busy() || !files().length}>{busy() ? '正在上传…' : '上传并创建后台任务'}</Button>
      </form>
      <Show when={messages().length}>
        <div class="space-y-1 text-sm" role="status">
          <For each={messages()}>{(m) => <p>{m}</p>}</For>
        </div>
      </Show>
      <Link to="/admin/jobs" class="text-primary underline">
        查看处理进度、失败记录和重试
      </Link>
    </div>
  );
}
