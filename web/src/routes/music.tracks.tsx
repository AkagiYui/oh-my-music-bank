import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { useState, useEffect, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invalidateMusicQueries } from '../lib/query-invalidation';
import { CheckIcon } from 'lucide-react';
import { TrackFilters } from '../components/TrackFilters';
import { Pagination } from '../components/Pagination';
import { createFileRoute } from '@tanstack/react-router';
import { api, type MetaSong } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent } from '../components/ui/card';
import { EntityPicker, type Entity } from '../components/admin/EntityPicker';
import { TrackPlayButton } from '../components/GlobalPlayer';
import { formatDuration } from '../lib/utils';
export const Route = createFileRoute('/music/tracks')({
  component: TracksPage,
});
const artistSearch = (q: string): Promise<Entity[]> =>
  api.admin.artists.list(q).then((r) => r.data.map((a) => ({ id: a.id, name: a.name })));
const artistCreate = (name: string): Promise<Entity> =>
  api.admin.artists.create(name).then((a) => {
    void invalidateMusicQueries();
    return { id: a.id, name: a.name };
  });
const albumSearch = (q: string): Promise<Entity[]> =>
  api.admin.albums.list(q).then((r) => r.data.map((a) => ({ id: a.id, name: a.title })));
const albumCreate = (name: string): Promise<Entity> =>
  api.admin.albums.create(name).then((a) => {
    void invalidateMusicQueries();
    return { id: a.id, name: a.title };
  });
function TracksPage() {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data: paged, isLoading: pagedLoading } = useQuery({
    queryKey: ['admin.tracks:paged', { term: term, page: page, filters: activeFilters }],
    queryFn: () => api.admin.tracks.list(term, page, activeFilters),
  });
  const list = () => paged?.data;
  const [editing, setEditing] = useState<string | null>(null);
  async function remove(id: string) {
    if (!confirm('确认删除该曲目？相关音频与对象也会被清理。')) return;
    await api.admin.tracks.remove(id);
    if (editing === id) setEditing(null);
    void invalidateMusicQueries();
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">曲目管理</h1>
      <Card>
        <CardContent className="space-y-4 p-4">
          <TrackFilters value={filters} onChange={setFilters} />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setActiveFilters(filters);
              setTerm(q.trim());
            }}
          >
            <Input placeholder="搜索标题、别名、艺术家或专辑" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>

          <div className="divide-y rounded-none border">
            {(list() ?? []).length ? (
              (list() ?? []).map((t, index) => (
                <Fragment key={t.id}>
                  <div>
                    <div className="flex items-center gap-3 p-3 text-sm">
                      {t.coverUrl ? (
                        <>
                          <img src={t.coverUrl} alt="" className="size-10 shrink-0 rounded-none object-cover" />
                        </>
                      ) : (
                        <div className="size-10 shrink-0 rounded-none bg-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{t.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {t.artists.map((a) => a.name).join(' / ') || '未知艺术家'} · {formatDuration(t.duration)}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {t.available ? (
                          <>
                            <Badge variant="outline">
                              <CheckIcon data-icon="inline-start" />
                              可搜索
                            </Badge>
                          </>
                        ) : (
                          <Badge variant="secondary">已下架</Badge>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(editing === t.id ? null : t.id)}>
                          {editing === t.id ? '收起' : '编辑'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
                          删除
                        </Button>
                      </div>
                    </div>
                    {editing === t.id ? (
                      <>
                        <div className="border-t bg-muted/30 p-4">
                          <TrackEditor id={t.id} onChanged={invalidateMusicQueries} />
                        </div>
                      </>
                    ) : null}
                  </div>
                </Fragment>
              ))
            ) : (
              <p className="p-3 text-sm text-muted-foreground">暂无曲目。</p>
            )}
          </div>
          <Pagination page={page} total={paged?.total ?? 0} pageSize={50} loading={pagedLoading} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
function TrackEditor(props: { id: string; onChanged: () => void }) {
  const { data: detail, refetch } = useQuery({
    queryKey: ['admin.tracks:detail', props.id],
    queryFn: () => api.admin.tracks.detail(props.id),
  });
  const { data: languages } = useQuery({
    queryKey: ['admin.tracks:languages'],
    queryFn: () => api.admin.languages.list(),
  });
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(0);
  const [available, setAvailable] = useState(true);
  const [lyric, setLyric] = useState('');
  const [lrc, setLrc] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [artists, setArtists] = useState<Entity[]>([]);
  const [albums, setAlbums] = useState<Entity[]>([]);
  const [langIds, setLangIds] = useState<number[]>([]);
  useEffect(() => {
    const d = detail;
    if (!d) return;
    setTitle(d.title);
    setDuration(d.duration);
    setAvailable(d.available);
    setLyric(d.lyric ?? '');
    setLrc(d.lrcLyric ?? '');
    setArtists(d.artists.map((a) => ({ id: a.id, name: a.name })));
    setAlbums((d.albums ?? []).map((a) => ({ id: a.id, name: a.title })));
    setLangIds((d.languages ?? []).map((l) => l.id));
  }, [detail]);
  const [metaQ, setMetaQ] = useState('');
  const [metaResults, setMetaResults] = useState<MetaSong[]>([]);
  const [metaBusy, setMetaBusy] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [metaFields, setMetaFields] = useState<string[]>([
    'title',
    'artists',
    'album',
    'lyric',
    'lrcLyric',
    'coverUrl',
  ]);
  async function searchMeta() {
    setMetaBusy(true);
    try {
      setMetaResults(await api.admin.metadata.search(metaQ.trim() || title || ''));
    } finally {
      setMetaBusy(false);
    }
  }
  async function applyMeta(songId: string) {
    setMetaBusy(true);
    try {
      const full = await api.admin.metadata.song(songId);
      const values: Record<string, unknown> = {
        title: full.title,
        artists: full.artists,
        album: full.album,
        lyric: full.lyric,
        lrcLyric: full.lrc,
        coverUrl: full.coverUrl,
      };
      await api.admin.metadata.enrich(
        props.id,
        Object.fromEntries(Object.entries(values).filter(([key]) => metaFields.includes(key))),
      );
      setMetaResults([]);
      void refetch();
      props.onChanged();
    } finally {
      setMetaBusy(false);
    }
  }
  async function saveBasics() {
    await api.admin.tracks.update(props.id, {
      title: title,
      duration: duration,
      available: available,
      lyric: lyric,
      lrcLyric: lrc,
    });
    props.onChanged();
    void refetch();
  }
  async function addAlias() {
    if (!aliasInput.trim()) return;
    await api.admin.tracks.addAlias(props.id, aliasInput.trim());
    void invalidateMusicQueries();
    setAliasInput('');
    void refetch();
  }
  async function delAlias(aid: string) {
    await api.admin.tracks.deleteAlias(props.id, aid);
    void invalidateMusicQueries();
    void refetch();
  }
  async function changeArtists(items: Entity[]) {
    setArtists(items);
    await api.admin.tracks.setArtists(
      props.id,
      items.map((i) => i.id),
    );
    void invalidateMusicQueries();
  }
  async function changeAlbums(items: Entity[]) {
    setAlbums(items);
    await api.admin.tracks.setAlbums(
      props.id,
      items.map((i) => i.id),
    );
    void invalidateMusicQueries();
  }
  async function toggleLang(id: number, checked: boolean) {
    const next = checked ? [...langIds, id] : langIds.filter((x) => x !== id);
    setLangIds(next);
    await api.admin.tracks.setLanguages(props.id, next);
    void invalidateMusicQueries();
  }
  async function delAudio(aid: string) {
    if (!confirm('删除该音质音频？')) return;
    await api.admin.audio.remove(aid);
    void invalidateMusicQueries();
    void refetch();
  }
  return (
    <div className="space-y-5">
      {/* 匹配元信息（网易云） */}
      <div className="space-y-2 rounded-none border border-primary/30 bg-primary/5 p-3">
        <div className="text-sm font-medium">匹配元信息（仅覆盖选中字段）</div>
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            ['title', '标题'],
            ['artists', '艺术家'],
            ['album', '专辑'],
            ['lyric', '歌词'],
            ['lrcLyric', 'LRC'],
            ['coverUrl', '封面'],
          ].map(([key, label], index) => (
            <Fragment key={key}>
              <label>
                <Checkbox
                  checked={metaFields.includes(key)}
                  onCheckedChange={(checked) =>
                    setMetaFields((v) => (checked === true ? [...v, key] : v.filter((x) => x !== key)))
                  }
                />{' '}
                {label}
              </label>
            </Fragment>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            className="h-9"
            placeholder="按歌名搜索（默认用当前标题）"
            value={metaQ}
            onChange={(e) => setMetaQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void searchMeta();
              }
            }}
          />
          <Button size="sm" variant="secondary" disabled={metaBusy} onClick={searchMeta}>
            {metaBusy ? '…' : '搜索'}
          </Button>
        </div>
        {metaResults.length > 0 ? (
          <>
            <div className="max-h-56 divide-y overflow-auto rounded-none border bg-background">
              {(metaResults ?? []).map((m, index) => (
                <Fragment key={m.id}>
                  <div className="flex items-center gap-2 p-2 text-sm">
                    {m.coverUrl ? (
                      <>
                        <img
                          src={m.coverUrl}
                          alt=""
                          className="size-9 shrink-0 rounded-none object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </>
                    ) : (
                      <div className="size-9 shrink-0 rounded-none bg-muted" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.artists.join(' / ')} · {m.album}
                      </div>
                    </div>
                    <Button size="sm" className="ml-auto" disabled={metaBusy} onClick={() => applyMeta(m.id)}>
                      应用
                    </Button>
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* 基础信息 */}
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">标题</div>
            <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">时长（秒）</div>
            <Input type="number" value={duration} onChange={(e) => setDuration(Number(e.currentTarget.value))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            className="size-4"
            checked={available}
            onCheckedChange={(checked) => setAvailable(checked === true)}
          />
          可被搜索
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">歌词（纯文本）</div>
            <Textarea rows={4} value={lyric} onChange={(e) => setLyric(e.currentTarget.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">LRC 歌词</div>
            <Textarea rows={4} value={lrc} onChange={(e) => setLrc(e.currentTarget.value)} />
          </div>
        </div>
        <Button size="sm" onClick={saveBasics}>
          保存基础信息
        </Button>
      </div>

      {/* 别名 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">别名</div>
        <div className="flex flex-wrap gap-1.5">
          {(detail?.aliasRows ?? []).length ? (
            (detail?.aliasRows ?? []).map((al, index) => (
              <Fragment key={al.id}>
                <Badge variant="secondary">
                  {al.alias}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => delAlias(al.id)}
                  >
                    ×
                  </button>
                </Badge>
              </Fragment>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">（无）</span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            className="h-9"
            placeholder="添加别名"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.currentTarget.value)}
          />
          <Button size="sm" variant="secondary" onClick={addAlias}>
            添加
          </Button>
        </div>
      </div>

      {/* 艺术家 / 专辑 */}
      <EntityPicker
        label="艺术家"
        selected={artists}
        search={artistSearch}
        onChange={changeArtists}
        allowCreate={artistCreate}
      />
      <EntityPicker
        label="专辑"
        selected={albums}
        search={albumSearch}
        onChange={changeAlbums}
        allowCreate={albumCreate}
      />

      {/* 语种 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">语种</div>
        <div className="flex flex-wrap gap-3">
          {(languages ?? []).map((l, index) => (
            <Fragment key={l.id}>
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  className="size-4"
                  checked={langIds.includes(l.id)}
                  onCheckedChange={(checked) => toggleLang(l.id, checked === true)}
                />
                {l.name}
              </label>
            </Fragment>
          ))}
        </div>
      </div>

      {/* 分发音频 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">分发音频 · 曲目 ID：{props.id}</div>
        {(detail?.audios ?? []).length > 0 ? (
          <>
            <TrackPlayButton
              track={detail!}
              scope={window.location.origin}
              resolvePlaybackURL={(id) => api.admin.audio.playbackURL(id)}
            />
            <div className="divide-y rounded-none border text-xs">
              {(detail?.audios ?? []).map((au, index) => (
                <Fragment key={au.id}>
                  <div className="flex flex-wrap items-center gap-2 p-2">
                    <Badge variant="outline">{au.qualityLabel}</Badge>
                    <span className="text-muted-foreground">
                      {au.source ? `${au.source} · ` : ''}
                      {au.format} · {Math.round(au.bitrate / 1000)} kbps · {au.samplingRate} Hz ·{' '}
                      {(au.size / 1048576).toFixed(1)} MB
                      {au.loudness != null ? ` · ${au.loudness.toFixed(1)} LUFS` : ''}
                    </span>
                    <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => delAudio(au.id)}>
                      删除
                    </Button>
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">无</p>
        )}
      </div>

      {/* 原始音频 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">原始音频</div>
        {(detail?.origins ?? []).length ? (
          (detail?.origins ?? []).map((o, index) => (
            <Fragment key={o.id}>
              <div className="flex flex-wrap items-center gap-2 rounded-none border p-2 text-xs">
                <Badge variant="secondary">{o.status}</Badge>
                <span className="text-muted-foreground">
                  {o.format} · {Math.round(o.bitrate / 1000)} kbps · {(o.size / 1048576).toFixed(1)} MB
                </span>
                <code className="text-muted-foreground">{o.hash.slice(0, 12)}…</code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6"
                  onClick={() => {
                    void api.admin.audio
                      .originDownloadURL(o.id)
                      .then((signed) => {
                        const link = document.createElement('a');
                        link.href = signed.url;
                        link.rel = 'noreferrer';
                        link.referrerPolicy = 'no-referrer';
                        link.click();
                      })
                      .catch(() => {
                        // API 客户端已显示错误；这里只负责避免事件处理器产生未处理拒绝。
                      });
                  }}
                >
                  下载原始文件
                </Button>
              </div>
            </Fragment>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">无</p>
        )}
      </div>
      <div className="space-y-2 rounded-none border p-3">
        <p className="text-sm">合并至已有曲目：保留目标基础信息，转移全部音频、关联和别名，然后删除当前曲目。</p>
        <Input placeholder="目标曲目 ID" value={mergeTarget} onChange={(e) => setMergeTarget(e.currentTarget.value)} />
        <Button
          variant="outline"
          disabled={!mergeTarget.trim()}
          onClick={async () => {
            if (!confirm('确认合并？此操作不可撤销。')) return;
            await api.admin.tracks.merge(props.id, mergeTarget.trim());
            props.onChanged();
          }}
        >
          合并曲目
        </Button>
      </div>
    </div>
  );
}
