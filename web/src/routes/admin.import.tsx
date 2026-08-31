import { NativeSelect } from '../components/ui/native-select';
import { Checkbox } from '../components/ui/checkbox';
import { useRef, useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { clearFeedback, notifyError } from '../lib/feedback';
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
  const { data: status } = useQuery({
    queryKey: ['admin.import:status'],
    queryFn: () => api.admin.bilibili.status(),
  });
  const { data: folders } = useQuery({
    queryKey: ['admin.import:folders'],
    queryFn: () => api.admin.bilibili.favorites().catch(() => []),
  });
  const [items, setItems] = useState<BiliMedia[]>([]);
  const [folderPage, setFolderPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const folderRequest = useRef(0);
  const videoRequest = useRef(0);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [bvInput, setBvInput] = useState('');
  const [video, setVideo] = useState<BiliVideoInfo | null>(null);
  const [cid, setCid] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [provider, setProvider] = useState('xfyun');
  const [cands, setCands] = useState<RecognizeCandidate[] | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const page = () => video?.pages.find((p) => p.cid === cid);
  const duration = () => page()?.duration ?? 0;
  const { data: streamUrl, isFetching: streamUrlLoading } = useQuery({
    queryKey: ['admin.import:streamUrl', video?.bvid, cid],
    queryFn: () => api.admin.bilibili.streamUrl(video!.bvid, cid),
    enabled: Boolean(video && cid),
  });
  async function openFolder(id: number, pn = 1) {
    const token = ++folderRequest.current;
    setFolderId(id);
    clearFeedback();
    try {
      const r = await api.admin.bilibili.favoriteItems(id, pn);
      if (token !== folderRequest.current) return;
      setItems(r.items);
      setFolderPage(pn);
      setHasMore(r.hasMore);
      setSelected([]);
    } catch (e) {
      if (token !== folderRequest.current) return;
      notifyError(e);
    }
  }
  async function openVideo(bvid: string) {
    const token = ++videoRequest.current;
    clearFeedback();
    try {
      const info = await api.admin.bilibili.resolve(bvid.trim());
      if (token !== videoRequest.current) return;
      if (!info.pages.length) throw new Error('视频没有可用分 P');
      // 新视频加载成功后再替换内容，失败时保留当前裁剪状态。
      setMsg('');
      setCands(null);
      setVideo(info);
      const p = info.pages[0];
      setCid(p.cid);
      setStart(0);
      setEnd(p.duration);
      setTitle(info.title);
      setArtist(info.owner);
    } catch (e) {
      if (token !== videoRequest.current) return;
      notifyError(e);
    }
  }
  function selectPage(c: number) {
    setCid(c);
    setStart(0);
    setEnd(video?.pages.find((p) => p.cid === c)?.duration ?? 0);
  }
  async function ingest(useSegment: boolean) {
    if (!video) return;
    setBusy('ingest');
    setMsg('');
    clearFeedback();
    try {
      const body: {
        bvid: string;
        cid: number;
        title: string;
        artist: string;
        startSec?: number;
        endSec?: number;
      } = {
        bvid: video!.bvid,
        cid: cid,
        title: title,
        artist: artist,
      };
      if (useSegment) {
        body.startSec = start;
        body.endSec = end;
      }
      await api.admin.jobs.bilibili([{ ...body, trackId: target.trim() }]);
      setMsg('已加入后台任务，可在收录任务中查看进度');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy('');
    }
  }
  async function recognize() {
    if (!video) return;
    setBusy('recognize');
    clearFeedback();
    try {
      const r = await api.admin.bilibili.recognize({
        bvid: video!.bvid,
        cid: cid,
        startSec: start,
        endSec: end,
        provider: provider,
      });
      setCands(r);
      if (r.length === 0) setMsg('未识别出结果，可调整片段重试');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">从哔哩哔哩导入</h1>

      {status?.configured ? (
        <>
          {/* 来源：收藏夹 + 直接输入 BV 号 */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                {(folders ?? []).length ? (
                  (folders ?? []).map((f, index) => (
                    <Fragment key={f.id}>
                      <Button
                        type="button"
                        variant={folderId === f.id ? 'default' : 'outline'}
                        aria-pressed={folderId === f.id}
                        onClick={() => openFolder(f.id)}
                      >
                        {f.title} ({f.mediaCount})
                      </Button>
                    </Fragment>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">没有收藏夹</span>
                )}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (bvInput.trim()) void openVideo(bvInput);
                }}
              >
                <Input
                  placeholder="或直接输入 BV 号（如 BV1xx411c7mD）"
                  value={bvInput}
                  onChange={(e) => setBvInput(e.currentTarget.value)}
                />
                <Button type="submit" variant="secondary">
                  打开
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* 收藏夹视频列表 */}
          {items.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={folderPage <= 1} onClick={() => openFolder(folderId!, folderPage - 1)}>
                  上一页
                </Button>
                <span>第 {folderPage} 页</span>
                <Button size="sm" disabled={!hasMore} onClick={() => openFolder(folderId!, folderPage + 1)}>
                  下一页
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setSelected(items.map((m) => m.bvid))}>
                  选择本页
                </Button>
                <Button
                  size="sm"
                  disabled={!selected.length || busy !== ''}
                  onClick={async () => {
                    setBusy('batch');
                    clearFeedback();
                    try {
                      const tasks: Record<string, unknown>[] = [];
                      for (const bvid of selected) {
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
                      notifyError(e);
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  批量导入所选视频的全部分 P
                </Button>
                <Link to="/admin/jobs" className="text-primary underline">
                  查看任务
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(items ?? []).map((m, index) => (
                  <Fragment key={m.bvid}>
                    <div className="flex gap-2">
                      <Checkbox
                        aria-label={`选择 ${m.title}`}
                        checked={selected.includes(m.bvid)}
                        onCheckedChange={(checked) =>
                          setSelected((s) => (checked === true ? [...s, m.bvid] : s.filter((v) => v !== m.bvid)))
                        }
                      />
                      <button
                        type="button"
                        className="flex items-center gap-3 rounded-none border p-2 text-left text-sm hover:bg-accent"
                        onClick={() => openVideo(m.bvid)}
                      >
                        <img
                          src={m.cover}
                          alt=""
                          className="h-12 w-20 shrink-0 rounded-none object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{m.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.upName} · {formatDuration(m.duration)}
                          </div>
                        </div>
                      </button>
                    </div>
                  </Fragment>
                ))}
              </div>
            </>
          ) : null}

          {/* 视频裁剪 + 入库 + 识别 */}
          {video ? (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-3">
                  <img
                    src={video!.cover}
                    alt=""
                    className="h-14 w-24 rounded-none object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{video!.title}</div>
                    <div className="text-xs text-muted-foreground">{video!.owner}</div>
                  </div>
                </div>

                {video!.pages.length > 1 ? (
                  <>
                    <NativeSelect
                      className="w-full"
                      value={cid}
                      onChange={(e) => selectPage(Number(e.currentTarget.value))}
                    >
                      {(video!.pages ?? []).map((p, index) => (
                        <Fragment key={p.cid}>
                          <option value={p.cid}>
                            P{p.page} {p.part} ({formatDuration(p.duration)})
                          </option>
                        </Fragment>
                      ))}
                    </NativeSelect>
                  </>
                ) : null}

                {!streamUrlLoading && streamUrl ? (
                  <>
                    <BiliCropper
                      src={streamUrl ?? ''}
                      duration={duration()}
                      start={start}
                      end={end}
                      onChange={(s, e) => {
                        setStart(s);
                        setEnd(e);
                      }}
                    />
                  </>
                ) : (
                  <p className="text-sm">加载试听地址…</p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
                  <Input
                    placeholder="已有曲目 ID（可选）"
                    value={target}
                    onChange={(e) => setTarget(e.currentTarget.value)}
                  />
                  <Input placeholder="艺术家" value={artist} onChange={(e) => setArtist(e.currentTarget.value)} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy !== ''} onClick={() => ingest(false)}>
                    加入整段
                  </Button>
                  <Button variant="secondary" disabled={busy !== ''} onClick={() => ingest(true)}>
                    加入此片段
                  </Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <NativeSelect value={provider} onChange={(e) => setProvider(e.currentTarget.value)}>
                    <option value="xfyun">讯飞</option>
                    <option value="netease" disabled>
                      网易云（暂未支持）
                    </option>
                  </NativeSelect>
                  <Button variant="outline" disabled={busy !== ''} onClick={recognize}>
                    {busy === 'recognize' ? '识别中…' : '识别此片段'}
                  </Button>
                </div>

                {msg ? (
                  <>
                    <p className="text-sm text-green-600">{msg}</p>
                  </>
                ) : null}

                {cands ? (
                  <>
                    <div className="space-y-1">
                      <div className="text-sm font-medium">识别结果</div>
                      {(cands ?? []).length ? (
                        (cands ?? []).map((c, index) => (
                          <Fragment key={index}>
                            <div className="flex items-center gap-2 rounded-none border p-2 text-sm">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{c.title}</div>
                                <div className="text-xs text-muted-foreground">
                                  {c.artist} · {c.source}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto"
                                onClick={() => {
                                  setTitle(c.title);
                                  setArtist(c.artist);
                                }}
                              >
                                用此填充
                              </Button>
                            </div>
                          </Fragment>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">无</p>
                      )}
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm">
            尚未配置哔哩哔哩 Cookie，请先前往{' '}
            <Link to="/admin/integrations" className="text-primary hover:underline">
              集成配置
            </Link>
            。
          </CardContent>
        </Card>
      )}
    </div>
  );
}
