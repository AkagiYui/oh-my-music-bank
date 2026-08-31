import { clearFeedback, notifyError } from '../lib/feedback';
import { useRef, useState, Fragment } from 'react';
import { Pagination } from '../components/Pagination';
import { TrackFilters } from '../components/TrackFilters';
import { createFileRoute } from '@tanstack/react-router';
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
  const [apiKey, setApiKey] = useState(localStorage.getItem(KEY_STORAGE) ?? '');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const searchRequest = useRef(0);
  const detailRequest = useRef(0);
  const [results, setResults] = useState<TrackDTO[]>([]);
  const [selected, setSelected] = useState<TrackDTO | null>(null);
  const [loading, setLoading] = useState(false);
  async function doSearch(e?: React.FormEvent, nextPage = 1) {
    const token = ++searchRequest.current;
    ++detailRequest.current;
    e?.preventDefault();
    clearFeedback();
    const key = apiKey.trim();
    if (!key) {
      notifyError('请先填写 API Key（可在控制台创建）');
      return;
    }
    if (!q.trim() && !Object.values(filters).some(Boolean)) return;
    localStorage.setItem(KEY_STORAGE, key);
    setLoading(true);
    try {
      const res = await api.open.search(key, q.trim(), nextPage, filters);
      if (token !== searchRequest.current) return;
      setPage(nextPage);
      setTotal(res.total);
      setResults(res.data);
      setSelected(null);
      if (res.data.length === 0) notifyError('没有找到相关曲目');
    } catch (err) {
      if (token !== searchRequest.current) return;
      notifyError(err instanceof ApiError ? `${err.status} ${err.message}` : String(err));
      // 请求失败保留已有结果和详情，提示错误时不让下方内容突然消失。
    } finally {
      if (token === searchRequest.current) setLoading(false);
    }
  }
  async function openDetail(t: TrackDTO) {
    const token = ++detailRequest.current;
    clearFeedback();
    try {
      const detail = await api.open.getTrack(apiKey.trim(), t.id);
      if (token === detailRequest.current) setSelected(detail);
    } catch (err) {
      if (token !== detailRequest.current) return;
      notifyError(err);
    }
  }
  const artistNames = (t: TrackDTO) => t.artists.map((a) => a.name).join(' / ') || '未知艺术家';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">试搜音乐</h1>
        <p className="text-sm text-muted-foreground">这里直接调用开放接口，体验 API 的真实返回。</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="key">API Key</Label>
            <Input
              id="key"
              type="password"
              placeholder="omb_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
          </div>
          <TrackFilters value={filters} onChange={setFilters} />
          <form className="flex gap-2" onSubmit={doSearch}>
            <Input placeholder="输入歌名 / 别名，如 告白气球" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            <Button type="submit" className="w-24 shrink-0" disabled={loading}>
              {loading ? '搜索中…' : '搜索'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 ? (
        <>
          <div className="divide-y rounded-none border">
            {(results ?? []).map((t, index) => (
              <Fragment key={index}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent"
                  onClick={() => openDetail(t)}
                >
                  {t.coverUrl ? (
                    <>
                      <img src={t.coverUrl} alt="" className="size-10 shrink-0 rounded-none object-cover" />
                    </>
                  ) : (
                    <div className="size-10 shrink-0 rounded-none bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.title}</div>
                    <div className="truncate text-sm text-muted-foreground">{artistNames(t)}</div>
                  </div>
                  <div className="text-sm tabular-nums text-muted-foreground">{formatDuration(t.duration)}</div>
                </button>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}

      <Pagination page={page} total={total} pageSize={20} loading={loading} onPage={(p) => doSearch(undefined, p)} />
      {selected ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-4">
              {selected!.coverUrl ? (
                <>
                  <img src={selected!.coverUrl} alt="" className="size-16 rounded-none object-cover" />
                </>
              ) : (
                <div className="size-16 rounded-none bg-muted" />
              )}
              <div>
                <div className="text-lg font-semibold">{selected!.title}</div>
                <div className="text-sm text-muted-foreground">{artistNames(selected!)}</div>
                {selected!.aliases.length > 0 ? (
                  <>
                    <div className="text-xs text-muted-foreground">别名：{selected!.aliases.join('、')}</div>
                  </>
                ) : null}
              </div>
            </div>

            {(selected!.audios ?? []).length > 0 ? (
              <>
                <AudioPlayer
                  sources={(selected!.audios ?? []).map((au) => ({
                    id: au.id,
                    label: `${au.qualityLabel} · ${Math.round(au.bitrate / 1000)}kbps`,
                    url: au.url,
                    loudness: au.loudness,
                  }))}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">暂无可播放音频。</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
