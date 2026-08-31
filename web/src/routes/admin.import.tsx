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
  const [folderPage, setFolderPage] = createSignal(1);
  const [hasMore, setHasMore] = createSignal(false);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [target, setTarget] = createSignal('');
  let folderRequest = 0;
  let videoRequest = 0;
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
  const [streamUrl] = createResource(
    () => (video() && cid() ? { bvid: video()!.bvid, cid: cid() } : null),
    (p) => api.admin.bilibili.streamUrl(p.bvid, p.cid),
  );

  async function openFolder(id: number, pn = 1) {
    const token = ++folderRequest;
    setFolderId(id);
    setErr('');
    try {
      const r = await api.admin.bilibili.favoriteItems(id, pn);
      if (token !== folderRequest) return;
      setItems(r.items);
      setFolderPage(pn);
      setHasMore(r.hasMore);
      setSelected([]);
    } catch (e) {
      if (token !== folderRequest) return;
      setErr(String(e));
    }
  }

  async function openVideo(bvid: string) {
    const token = ++videoRequest;
    setErr('');
    setMsg('');
    setVideo(null);
    setCands(null);
    try {
      const info = await api.admin.bilibili.resolve(bvid.trim());
      if (token !== videoRequest) return;
      if (!info.pages.length) throw new Error('视频没有可用分 P');
      setVideo(info);
      const p = info.pages[0];
      setCid(p.cid);
      setStart(0);
      setEnd(p.duration);
      setTitle(info.title);
      setArtist(info.owner);
    } catch (e) {
      if (token !== videoRequest) return;
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
      const body: {
        bvid: string;
        cid: number;
        title: string;
        artist: string;
        startSec?: number;
        endSec?: number;
      } = {
        bvid: video()!.bvid,
        cid: cid(),
        title: title(),
        artist: artist(),
      };
      if (useSegment) {
        body.startSec = start();
        body.endSec = end();
      }
      await api.admin.jobs.bilibili([{ ...body, trackId: target().trim() }]);
      setMsg('已加入后台任务，可在收录任务中查看进度');
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
              <Input
                placeholder="或直接输入 BV 号（如 BV1xx411c7mD）"
                value={bvInput()}
                onInput={(e) => setBvInput(e.currentTarget.value)}
              />
              <Button type="submit" variant="secondary">
                打开
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 收藏夹视频列表 */}
        <Show when={items().length > 0}>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={folderPage() <= 1} onClick={() => openFolder(folderId()!, folderPage() - 1)}>
              上一页
            </Button>
            <span>第 {folderPage()} 页</span>
            <Button size="sm" disabled={!hasMore()} onClick={() => openFolder(folderId()!, folderPage() + 1)}>
              下一页
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelected(items().map((m) => m.bvid))}>
              选择本页
            </Button>
            <Button
              size="sm"
              disabled={!selected().length || busy() !== ''}
              onClick={async () => {
                setBusy('batch');
                setErr('');
                try {
                  const tasks: Record<string, unknown>[] = [];
                  for (const bvid of selected()) {
                    const info = await api.admin.bilibili.resolve(bvid);
                    for (const p of info.pages)
                      tasks.push({
                        bvid,
                        cid: p.cid,
                        title: info.pages.length > 1 ? p.part : info.title,
                        artist: info.owner,
                      });
                  }
                  for (let i = 0; i < tasks.length; i += 50) await api.admin.jobs.bilibili(tasks.slice(i, i + 50));
                  setSelected([]);
                  setMsg(`已提交 ${tasks.length} 个分 P 收录任务`);
                } catch (e) {
                  setErr(String(e));
                } finally {
                  setBusy('');
                }
              }}
            >
              批量导入所选视频的全部分 P
            </Button>
            <Link to="/admin/jobs" class="text-primary underline">
              查看任务
            </Link>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <For each={items()}>
              {(m) => (
                <div class="flex gap-2">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${m.title}`}
                    checked={selected().includes(m.bvid)}
                    onChange={(e) =>
                      setSelected((s) => (e.currentTarget.checked ? [...s, m.bvid] : s.filter((v) => v !== m.bvid)))
                    }
                  />
                  <button
                    type="button"
                    class="flex items-center gap-3 rounded-md border p-2 text-left text-sm hover:bg-accent"
                    onClick={() => openVideo(m.bvid)}
                  >
                    <img
                      src={m.cover}
                      alt=""
                      class="h-12 w-20 shrink-0 rounded object-cover"
                      referrerpolicy="no-referrer"
                    />
                    <div class="min-w-0">
                      <div class="truncate font-medium">{m.title}</div>
                      <div class="text-xs text-muted-foreground">
                        {m.upName} · {formatDuration(m.duration)}
                      </div>
                    </div>
                  </button>
                </div>
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

                <Show when={!streamUrl.loading && streamUrl()} fallback={<p class="text-sm">加载试听地址…</p>}>
                  <BiliCropper
                    src={streamUrl() ?? ''}
                    duration={duration()}
                    start={start()}
                    end={end()}
                    onChange={(s, e) => {
                      setStart(s);
                      setEnd(e);
                    }}
                  />
                </Show>

                <div class="grid gap-3 sm:grid-cols-2">
                  <Input placeholder="标题" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
                  <Input
                    placeholder="已有曲目 ID（可选）"
                    value={target()}
                    onInput={(e) => setTarget(e.currentTarget.value)}
                  />
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
                    <option value="netease" disabled>
                      网易云（暂未支持）
                    </option>
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
