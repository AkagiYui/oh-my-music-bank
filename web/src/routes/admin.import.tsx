/** 路由 `/admin/import` —— 从哔哩哔哩收藏夹导入音频：浏览、裁剪、入库、听歌识曲。 */
import { For, Show, createResource, createSignal } from 'solid-js';
import { createFileRoute, Link } from '@tanstack/solid-router';
import { api, type BiliMedia, type BiliVideoInfo, type RecognizeCandidate } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { BiliCropper } from '../components/BiliCropper';
import { formatDuration } from '../lib/utils';

export const Route = createFileRoute('/admin/import')({
  component: ImportPage,
});

function ImportPage() {
  const [status] = createResource(() => api.admin.bilibili.status());
  const [folders] = createResource(() => api.admin.bilibili.favorites().catch(() => []));
  const [items, setItems] = createSignal<BiliMedia[]>([]);
  const [folderId, setFolderId] = createSignal<number | null>(null);
  const [bvInput, setBvInput] = createSignal('');

  const [video, setVideo] = createSignal<BiliVideoInfo | null>(null);
  const [cid, setCid] = createSignal(0);
  const [start, setStart] = createSignal(0);
  const [end, setEnd] = createSignal(0);
  const [title, setTitle] = createSignal('');
  const [artist, setArtist] = createSignal('');

  const [provider, setProvider] = createSignal('xfyun');
  const [cands, setCands] = createSignal<RecognizeCandidate[] | null>(null);
  const [busy, setBusy] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [err, setErr] = createSignal('');

  const page = () => video()?.pages.find((p) => p.cid === cid());
  const duration = () => page()?.duration ?? 0;
  const streamUrl = () => (video() ? api.admin.bilibili.streamUrl(video()!.bvid, cid()) : '');

  async function openFolder(id: number) {
    setFolderId(id);
    setErr('');
    try {
      const r = await api.admin.bilibili.favoriteItems(id);
      setItems(r.items);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function openVideo(bvid: string) {
    setErr('');
    setMsg('');
    setVideo(null);
    setCands(null);
    try {
      const info = await api.admin.bilibili.resolve(bvid.trim());
      setVideo(info);
      const p = info.pages[0];
      setCid(p.cid);
      setStart(0);
      setEnd(p.duration);
      setTitle(info.title);
      setArtist(info.owner);
    } catch (e) {
      setErr(String(e));
    }
  }

  function selectPage(c: number) {
    setCid(c);
    setStart(0);
    setEnd(video()?.pages.find((p) => p.cid === c)?.duration ?? 0);
  }

  async function ingest(useSegment: boolean) {
    if (!video()) return;
    setBusy('ingest');
    setMsg('');
    setErr('');
    try {
      const body: { bvid: string; cid: number; title: string; artist: string; startSec?: number; endSec?: number } = {
        bvid: video()!.bvid,
        cid: cid(),
        title: title(),
        artist: artist(),
      };
      if (useSegment) {
        body.startSec = start();
        body.endSec = end();
      }
      const d = await api.admin.bilibili.ingest(body);
      const track = d.track ?? d;
      setMsg(`已加入：${track.title}${d.deduplicated ? '（已存在，自动去重）' : ''}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy('');
    }
  }

  async function recognize() {
    if (!video()) return;
    setBusy('recognize');
    setErr('');
    setCands(null);
    try {
      const r = await api.admin.bilibili.recognize({
        bvid: video()!.bvid,
        cid: cid(),
        startSec: start(),
        endSec: end(),
        provider: provider(),
      });
      setCands(r);
      if (r.length === 0) setMsg('未识别出结果，可调整片段重试');
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">从哔哩哔哩导入</h1>

      <Show
        when={status()?.configured}
        fallback={
          <Card>
            <CardContent class="p-4 text-sm">
              尚未配置哔哩哔哩 Cookie，请先前往{' '}
              <Link to="/admin/integrations" class="text-primary hover:underline">
                集成配置
              </Link>
              。
            </CardContent>
          </Card>
        }
      >
        {/* 来源：收藏夹 + 直接输入 BV 号 */}
        <Card>
          <CardContent class="space-y-3 p-4">
            <div class="flex flex-wrap gap-2">
              <For each={folders() ?? []} fallback={<span class="text-sm text-muted-foreground">没有收藏夹</span>}>
                {(f) => (
                  <button
                    type="button"
                    class={
                      'rounded-full border px-3 py-1 text-sm ' +
                      (folderId() === f.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')
                    }
                    onClick={() => openFolder(f.id)}
                  >
                    {f.title} ({f.mediaCount})
                  </button>
                )}
              </For>
            </div>
            <form
              class="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (bvInput().trim()) openVideo(bvInput());
              }}
            >
              <Input placeholder="或直接输入 BV 号（如 BV1xx411c7mD）" value={bvInput()} onInput={(e) => setBvInput(e.currentTarget.value)} />
              <Button type="submit" variant="secondary">
                打开
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 收藏夹视频列表 */}
        <Show when={items().length > 0}>
          <div class="grid gap-2 sm:grid-cols-2">
            <For each={items()}>
              {(m) => (
                <button
                  type="button"
                  class="flex items-center gap-3 rounded-md border p-2 text-left text-sm hover:bg-accent"
                  onClick={() => openVideo(m.bvid)}
                >
                  <img src={m.cover} alt="" class="h-12 w-20 shrink-0 rounded object-cover" referrerpolicy="no-referrer" />
                  <div class="min-w-0">
                    <div class="truncate font-medium">{m.title}</div>
                    <div class="text-xs text-muted-foreground">
                      {m.upName} · {formatDuration(m.duration)}
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* 视频裁剪 + 入库 + 识别 */}
        <Show when={video()}>
          {(v) => (
            <Card>
              <CardContent class="space-y-4 p-4">
                <div class="flex items-center gap-3">
                  <img src={v().cover} alt="" class="h-14 w-24 rounded object-cover" referrerpolicy="no-referrer" />
                  <div class="min-w-0">
                    <div class="truncate font-medium">{v().title}</div>
                    <div class="text-xs text-muted-foreground">{v().owner}</div>
                  </div>
                </div>

                <Show when={v().pages.length > 1}>
                  <select
                    class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    onChange={(e) => selectPage(Number(e.currentTarget.value))}
                  >
                    <For each={v().pages}>
                      {(p) => (
                        <option value={p.cid} selected={p.cid === cid()}>
                          P{p.page} {p.part} ({formatDuration(p.duration)})
                        </option>
                      )}
                    </For>
                  </select>
                </Show>

                <BiliCropper
                  src={streamUrl()}
                  duration={duration()}
                  start={start()}
                  end={end()}
                  onChange={(s, e) => {
                    setStart(s);
                    setEnd(e);
                  }}
                />

                <div class="grid gap-3 sm:grid-cols-2">
                  <Input placeholder="标题" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
                  <Input placeholder="艺术家" value={artist()} onInput={(e) => setArtist(e.currentTarget.value)} />
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button disabled={busy() !== ''} onClick={() => ingest(false)}>
                    加入整段
                  </Button>
                  <Button variant="secondary" disabled={busy() !== ''} onClick={() => ingest(true)}>
                    加入此片段
                  </Button>
                  <span class="mx-1 h-5 w-px bg-border" />
                  <select
                    class="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={provider()}
                    onChange={(e) => setProvider(e.currentTarget.value)}
                  >
                    <option value="xfyun">讯飞</option>
                    <option value="netease">网易云</option>
                  </select>
                  <Button variant="outline" disabled={busy() !== ''} onClick={recognize}>
                    {busy() === 'recognize' ? '识别中…' : '识别此片段'}
                  </Button>
                </div>

                <Show when={msg()}>
                  <p class="text-sm text-green-600">{msg()}</p>
                </Show>
                <Show when={err()}>
                  <p class="text-sm text-destructive">{err()}</p>
                </Show>

                <Show when={cands()}>
                  <div class="space-y-1">
                    <div class="text-sm font-medium">识别结果</div>
                    <For each={cands()} fallback={<p class="text-xs text-muted-foreground">无</p>}>
                      {(c) => (
                        <div class="flex items-center gap-2 rounded-md border p-2 text-sm">
                          <div class="min-w-0">
                            <div class="truncate font-medium">{c.title}</div>
                            <div class="text-xs text-muted-foreground">
                              {c.artist} · {c.source}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            class="ml-auto"
                            onClick={() => {
                              setTitle(c.title);
                              setArtist(c.artist);
                            }}
                          >
                            用此填充
                          </Button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </CardContent>
            </Card>
          )}
        </Show>
      </Show>
    </div>
  );
}
