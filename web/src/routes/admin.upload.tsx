/** 路由 `/admin/upload` —— 上传音频，系统自动解析并入库。 */
import { Show, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api, ApiError, type TrackDTO } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { AudioPlayer } from '../components/AudioPlayer';
import { formatDuration } from '../lib/utils';

export const Route = createFileRoute('/admin/upload')({
  component: UploadPage,
});

function UploadPage() {
  let fileInput!: HTMLInputElement;
  const [file, setFile] = createSignal<File | null>(null);
  const [title, setTitle] = createSignal('');
  const [artist, setArtist] = createSignal('');
  const [result, setResult] = createSignal<TrackDTO | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!file()) {
      setError('请选择音频文件');
      return;
    }
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const t = await api.admin.audio.upload(file()!, { title: title().trim(), artist: artist().trim() });
      setResult(t);
      setTitle('');
      setArtist('');
      setFile(null);
      if (fileInput) fileInput.value = '';
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="max-w-2xl space-y-4">
      <h1 class="text-2xl font-semibold">上传音频</h1>
      <Card>
        <CardHeader>
          <CardTitle>上传</CardTitle>
          <CardDescription>系统会自动解析标题、艺术家、时长与音频参数；留空则用文件标签。相同文件会自动去重。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <form class="space-y-4" onSubmit={submit}>
            <div class="space-y-1.5">
              <Label for="file">音频文件</Label>
              <Input id="file" ref={fileInput} type="file" accept="audio/*" onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="title">标题（可选）</Label>
                <Input id="title" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
              </div>
              <div class="space-y-1.5">
                <Label for="artist">艺术家（可选）</Label>
                <Input id="artist" value={artist()} onInput={(e) => setArtist(e.currentTarget.value)} />
              </div>
            </div>
            <Show when={error()}>
              <p class="text-sm text-destructive">{error()}</p>
            </Show>
            <Button type="submit" disabled={busy()}>
              {busy() ? '上传解析中…' : '上传'}
            </Button>
          </form>

          <Show when={result()}>
            {(t) => (
              <div class="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                <div class="font-medium">已收录：{t().title}</div>
                <div class="text-sm text-muted-foreground">
                  {t().artists.map((a) => a.name).join(' / ') || '未知艺术家'} · {formatDuration(t().duration)}
                </div>
                <Show when={(t().audios ?? []).length > 0}>
                  <AudioPlayer
                    sources={(t().audios ?? []).map((au) => ({
                      id: au.id,
                      label: `${au.qualityLabel} · ${Math.round(au.bitrate / 1000)}kbps`,
                      url: au.url,
                      loudness: au.loudness,
                    }))}
                  />
                </Show>
              </div>
            )}
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}
