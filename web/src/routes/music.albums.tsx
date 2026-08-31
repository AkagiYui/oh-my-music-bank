import { Badge } from '../components/ui/badge';
import { useState, useEffect, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invalidateMusicQueries } from '../lib/query-invalidation';
import { Pagination } from '../components/Pagination';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { EntityPicker, type Entity } from '../components/admin/EntityPicker';
import { formatDuration } from '../lib/utils';
export const Route = createFileRoute('/music/albums')({
  component: AlbumsPage,
});
const artistSearch = (q: string): Promise<Entity[]> =>
  api.admin.artists.list(q).then((r) => r.data.map((a) => ({ id: a.id, name: a.name })));
const artistCreate = (name: string): Promise<Entity> =>
  api.admin.artists.create(name).then((a) => {
    void invalidateMusicQueries();
    return { id: a.id, name: a.name };
  });
function AlbumsPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data: paged, isLoading: pagedLoading } = useQuery({
    queryKey: ['admin.albums:paged', { term: term, page: page }],
    queryFn: () => api.admin.albums.list(term, page),
  });
  const list = () => paged?.data;
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  async function create() {
    if (!newTitle.trim()) return;
    await api.admin.albums.create(newTitle.trim());
    setNewTitle('');
    void invalidateMusicQueries();
  }
  async function remove(id: string) {
    if (!confirm('删除该专辑？')) return;
    await api.admin.albums.remove(id);
    if (editing === id) setEditing(null);
    void invalidateMusicQueries();
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">专辑管理</h1>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            <form
              className="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setTerm(q.trim());
              }}
            >
              <Input placeholder="搜索专辑" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
              <Button type="submit" variant="secondary">
                搜索
              </Button>
            </form>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Input placeholder="新建专辑名" value={newTitle} onChange={(e) => setNewTitle(e.currentTarget.value)} />
              <Button type="submit">新建</Button>
            </form>
          </div>

          <div className="divide-y rounded-none border">
            {(list() ?? []).length ? (
              (list() ?? []).map((a, index) => (
                <Fragment key={a.id}>
                  <div>
                    <div className="flex items-center gap-3 p-3 text-sm">
                      {a.coverUrl ? (
                        <>
                          <img src={a.coverUrl} alt="" className="size-9 shrink-0 rounded-none object-cover" />
                        </>
                      ) : (
                        <div className="size-9 shrink-0 rounded-none bg-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.trackCount} 首曲目</div>
                      </div>
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                          {editing === a.id ? '收起' : '编辑'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>
                          删除
                        </Button>
                      </div>
                    </div>
                    {editing === a.id ? (
                      <>
                        <div className="border-t bg-muted/30 p-4">
                          <AlbumEditor id={a.id} onRenamed={invalidateMusicQueries} />
                        </div>
                      </>
                    ) : null}
                  </div>
                </Fragment>
              ))
            ) : (
              <p className="p-3 text-sm text-muted-foreground">暂无专辑。</p>
            )}
          </div>
          <Pagination page={page} total={paged?.total ?? 0} pageSize={50} loading={pagedLoading} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
function AlbumEditor(props: { id: string; onRenamed: () => void }) {
  const { data: detail, refetch } = useQuery({
    queryKey: ['admin.albums:detail', props.id],
    queryFn: () => api.admin.albums.detail(props.id),
  });
  const [title, setTitle] = useState('');
  const [coverKey, setCoverKey] = useState('');
  const [artists, setArtists] = useState<Entity[]>([]);
  const [order, setOrder] = useState<
    {
      id: string;
      title: string;
      trackNo: number;
      discNo: number;
    }[]
  >([]);
  useEffect(() => {
    const d = detail;
    if (d) {
      setTitle(d.title);
      setOrder(
        d.tracks.map((t, i) => ({
          id: t.id,
          title: t.title,
          trackNo: t.trackNo ?? i + 1,
          discNo: t.discNo ?? 1,
        })),
      );
      setCoverKey(d.coverKey ?? '');
      setArtists(d.artists.map((a) => ({ id: a.id, name: a.name })));
    }
  }, [detail]);
  async function save() {
    await api.admin.albums.update(props.id, {
      title: title,
      coverKey: coverKey,
    });
    props.onRenamed();
    void refetch();
  }
  async function changeArtists(items: Entity[]) {
    setArtists(items);
    await api.admin.albums.setArtists(
      props.id,
      items.map((i) => i.id),
    );
    void invalidateMusicQueries();
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">标题</div>
          <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">封面 key（对象存储）</div>
          <Input value={coverKey} onChange={(e) => setCoverKey(e.currentTarget.value)} />
        </div>
      </div>
      <Button size="sm" onClick={save}>
        保存
      </Button>

      <EntityPicker
        label="艺术家"
        selected={artists}
        search={artistSearch}
        onChange={changeArtists}
        allowCreate={artistCreate}
      />

      <div className="space-y-1">
        <div className="text-sm font-medium">曲目（{detail?.tracks.length ?? 0}）</div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {(detail?.tracks ?? []).length ? (
            (detail?.tracks ?? []).map((t, index) => (
              <Fragment key={t.id}>
                <Badge variant="outline">
                  {t.title} · {formatDuration(t.duration)}
                </Badge>
              </Fragment>
            ))
          ) : (
            <span>无</span>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm">编辑曲序与碟号</p>
        {(order ?? []).map((t, i) => (
          <Fragment key={t.id}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <Input
                className="w-20"
                type="number"
                min="1"
                aria-label="碟号"
                value={t.discNo}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  setOrder((v) => v.map((x, k) => (k === i ? { ...x, discNo: n } : x)));
                }}
              />
              <Input
                className="w-20"
                type="number"
                min="1"
                aria-label="曲序"
                value={t.trackNo}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  setOrder((v) => v.map((x, k) => (k === i ? { ...x, trackNo: n } : x)));
                }}
              />
            </div>
          </Fragment>
        ))}
        <Button
          size="sm"
          onClick={async () => {
            await api.admin.albums.orderTracks(props.id, order);
            void invalidateMusicQueries();
            void refetch();
          }}
        >
          保存曲序
        </Button>
      </div>
    </div>
  );
}
