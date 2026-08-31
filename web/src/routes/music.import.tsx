import { invalidateJobQueries } from '../lib/query-invalidation';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
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
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
export const Route = createFileRoute('/music/import')({
  component: ImportPage,
});
const providerItems = [
  { value: 'xfyun', label: '讯飞', disabled: false },
  { value: 'netease', label: '网易云（暂未支持）', disabled: true },
];
function ImportPage() {
  const { data: status } = useQuery({
    queryKey: ['admin.import:status'],
    queryFn: () => api.admin.bilibili.status(),
  });
  const {
    data: accounts,
    error,
    refetch,
  } = useQuery({
    queryKey: ['bilibili:accounts'],
    queryFn: api.admin.bilibili.accounts,
  });
  const [selectedAccount, setSelectedAccount] = useState('');
  const accountId = selectedAccount || status?.defaultAccountId || accounts?.find((a) => a.isDefault)?.id || '';
  // 与分 P 选择共用主题弹层；items 保证弹层首次打开前就能显示账号名称。
  const accountItems = [
    { value: '', label: '请选择账号', disabled: false },
    ...(accounts ?? []).map((account) => ({
      value: account.id,
      label: `${account.name}${account.isDefault ? '（默认）' : ''}${account.status === 'expired' ? '（登录失效）' : ''}`,
      disabled: account.status === 'expired',
    })),
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">从哔哩哔哩导入</h1>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="bili-import-account">导入账号</FieldLabel>
          <Select
            items={accountItems}
            value={accountId}
            onValueChange={(value) => {
              if (value !== null) setSelectedAccount(value);
            }}
          >
            <SelectTrigger id="bili-import-account" aria-label="导入账号" className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {accountItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">
        切换账号会清空当前收藏夹和裁剪选择；已提交任务仍使用提交时的账号。
        <Link to="/admin/integrations" className="underline">
          管理账号
        </Link>
      </p>
      {error && (
        <Button variant="outline" onClick={() => void refetch()}>
          账号加载失败，重试
        </Button>
      )}
      {/* 按账号重建工作区，同时销毁分页、视频选择与媒体令牌，避免跨账号复用。 */}
      <ImportWorkspace
        key={accountId}
        accountId={accountId}
        configured={
          !!status?.configured && !!accountId && !!accounts?.some((a) => a.id === accountId && a.status !== 'expired')
        }
      />
    </div>
  );
}

function ImportWorkspace({ accountId, configured }: { accountId: string; configured: boolean }) {
  const {
    data: folders,
    error: folderError,
    refetch: refetchFolders,
  } = useQuery({
    queryKey: ['admin.import:folders', accountId],
    queryFn: () => api.admin.bilibili.favorites(accountId),
    enabled: configured,
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
  // 保持 CID 为数字；items 让弹层首次打开前也能显示对应的分 P 标题。
  const pageItems = (video?.pages ?? []).map((p) => ({
    value: p.cid,
    label: `P${p.page} ${p.part} (${formatDuration(p.duration)})`,
  }));
  const page = () => video?.pages.find((p) => p.cid === cid);
  const duration = () => page()?.duration ?? 0;
  const { data: streamUrl, isFetching: streamUrlLoading } = useQuery({
    queryKey: ['admin.import:streamUrl', accountId, video?.bvid, cid],
    // 媒体令牌有独立有效期，不沿用普通业务数据的缓存周期。
    staleTime: 0,
    gcTime: 0,
    queryFn: () => api.admin.bilibili.streamUrl(video!.bvid, cid, accountId),
    enabled: Boolean(video && cid),
  });
  async function openFolder(id: number, pn = 1) {
    const token = ++folderRequest.current;
    setFolderId(id);
    clearFeedback();
    try {
      const r = await api.admin.bilibili.favoriteItems(id, pn, accountId);
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
      const info = await api.admin.bilibili.resolve(bvid.trim(), accountId);
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
      await api.admin.jobs.bilibili([{ ...body, accountId, trackId: target.trim() }]);
      void invalidateJobQueries();
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
        accountId,
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
      {folderError && (
        <Button variant="outline" onClick={() => void refetchFolders()}>
          收藏夹加载失败，重试
        </Button>
      )}
      {configured ? (
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
                        const info = await api.admin.bilibili.resolve(bvid, accountId);
                        for (const p of info.pages)
                          tasks.push({
                            accountId,
                            bvid,
                            cid: p.cid,
                            title: info.pages.length > 1 ? p.part : info.title,
                            artist: info.owner,
                          });
                      }
                      for (let i = 0; i < tasks.length; i += 50) {
                        await api.admin.jobs.bilibili(tasks.slice(i, i + 50));
                        void invalidateJobQueries();
                      }
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
                <Link to="/music/jobs" className="text-primary underline">
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
                    <Select
                      items={pageItems}
                      value={cid}
                      onValueChange={(value) => {
                        if (value !== null) selectPage(value);
                      }}
                    >
                      <SelectTrigger aria-label="视频分 P" className="w-full min-w-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {pageItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
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
                  <Select
                    items={providerItems}
                    value={provider}
                    onValueChange={(value) => {
                      if (value !== null) setProvider(value);
                    }}
                  >
                    <SelectTrigger aria-label="识别服务">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {providerItems.map((item) => (
                          <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
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
            尚未选择可用的哔哩哔哩账号，请先前往{' '}
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
