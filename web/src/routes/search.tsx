/** 路由 `/search` —— 用 API Key 试搜音乐并播放。 */
import { For, Show, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api, ApiError, type TrackDTO } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { AudioPlayer } from '../components/AudioPlayer';
import { formatDuration } from '../lib/utils';

export const Route = createFileRoute('/search')({
  component: SearchPage,
});

const KEY_STORAGE = 'ommb.tryKey';

function SearchPage() {
  const [apiKey, setApiKey] = createSignal(localStorage.getItem(KEY_STORAGE) ?? '');
  const [q, setQ] = createSignal('');
  const [results, setResults] = createSignal<TrackDTO[]>([]);
  const [selected, setSelected] = createSignal<TrackDTO | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');

  async function doSearch(e?: Event) {
    e?.preventDefault();
    setError('');
    setSelected(null);
    const key = apiKey().trim();
    if (!key) {
      setError('请先填写 API Key（可在控制台创建）');
      return;
    }
    if (!q().trim()) return;
    localStorage.setItem(KEY_STORAGE, key);
    setLoading(true);
    try {
      const res = await api.open.search(key, q().trim());
      setResults(res.data);
      if (res.data.length === 0) setError('没有找到相关曲目');
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.message}` : String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(t: TrackDTO) {
    setError('');
    try {
      setSelected(await api.open.getTrack(apiKey().trim(), t.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const artistNames = (t: TrackDTO) => t.artists.map((a) => a.name).join(' / ') || '未知艺术家';

  return (
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-semibold">试搜音乐</h1>
        <p class="text-sm text-muted-foreground">这里直接调用开放接口，体验 API 的真实返回。</p>
      </div>

      <Card>
        <CardContent class="space-y-4 p-6">
          <div class="space-y-1.5">
            <Label for="key">API Key</Label>
            <Input
              id="key"
              type="password"
              placeholder="omb_..."
              value={apiKey()}
              onInput={(e) => setApiKey(e.currentTarget.value)}
            />
          </div>
          <form class="flex gap-2" onSubmit={doSearch}>
            <Input placeholder="输入歌名 / 别名，如 告白气球" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
            <Button type="submit" disabled={loading()}>
              {loading() ? '搜索中…' : '搜索'}
            </Button>
          </form>
          <Show when={error()}>
            <p class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error()}</p>
          </Show>
        </CardContent>
      </Card>

      <Show when={results().length > 0}>
        <div class="divide-y rounded-md border">
          <For each={results()}>
            {(t) => (
              <button
                type="button"
                class="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent"
                onClick={() => openDetail(t)}
              >
                <Show
                  when={t.coverUrl}
                  fallback={<div class="size-10 shrink-0 rounded bg-muted" />}
                >
                  <img src={t.coverUrl} alt="" class="size-10 shrink-0 rounded object-cover" />
                </Show>
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium">{t.title}</div>
                  <div class="truncate text-sm text-muted-foreground">{artistNames(t)}</div>
                </div>
                <div class="text-sm tabular-nums text-muted-foreground">{formatDuration(t.duration)}</div>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={selected()}>
        {(t) => (
          <Card>
            <CardContent class="space-y-4 p-6">
              <div class="flex items-center gap-4">
                <Show when={t().coverUrl} fallback={<div class="size-16 rounded bg-muted" />}>
                  <img src={t().coverUrl} alt="" class="size-16 rounded object-cover" />
                </Show>
                <div>
                  <div class="text-lg font-semibold">{t().title}</div>
                  <div class="text-sm text-muted-foreground">{artistNames(t())}</div>
                  <Show when={t().aliases.length > 0}>
                    <div class="text-xs text-muted-foreground">别名：{t().aliases.join('、')}</div>
                  </Show>
                </div>
              </div>

              <Show when={(t().audios ?? []).length > 0} fallback={<p class="text-sm text-muted-foreground">暂无可播放音频。</p>}>
                <AudioPlayer
                  sources={(t().audios ?? []).map((au) => ({
                    id: au.id,
                    label: `${au.qualityLabel} · ${Math.round(au.bitrate / 1000)}kbps`,
                    url: au.url,
                    loudness: au.loudness,
                  }))}
                />
              </Show>
            </CardContent>
          </Card>
        )}
      </Show>
    </div>
  );
}
