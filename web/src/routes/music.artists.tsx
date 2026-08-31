import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { useState, useEffect, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invalidateMusicQueries } from '../lib/query-invalidation';
import { Pagination } from '../components/Pagination';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
export const Route = createFileRoute('/music/artists')({
  component: ArtistsPage,
});
function ArtistsPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data: paged, isLoading: pagedLoading } = useQuery({
    queryKey: ['admin.artists:paged', { term: term, page: page }],
    queryFn: () => api.admin.artists.list(term, page),
  });
  const list = () => paged?.data;
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  async function create() {
    if (!newName.trim()) return;
    await api.admin.artists.create(newName.trim());
    setNewName('');
    void invalidateMusicQueries();
  }
  async function remove(id: string) {
    if (!confirm('删除该艺术家？')) return;
    await api.admin.artists.remove(id);
    if (editing === id) setEditing(null);
    void invalidateMusicQueries();
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">艺术家管理</h1>
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
              <Input placeholder="搜索艺术家" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
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
              <Input placeholder="新建艺术家名" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} />
              <Button type="submit">新建</Button>
            </form>
          </div>

          <div className="divide-y rounded-none border">
            {(list() ?? []).length ? (
              (list() ?? []).map((a, index) => (
                <Fragment key={a.id}>
                  <div>
                    <div className="flex items-center gap-3 p-3 text-sm">
                      {/* Lyra 的官方 Avatar 仍为圆形；用组件保留该设计及加载失败回退。 */}
                      <Avatar className="size-9">
                        <AvatarImage src={a.avatarUrl} alt="" />
                        <AvatarFallback aria-hidden="true">{Array.from(a.name)[0]}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.name}</div>
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
                          <ArtistEditor id={a.id} onRenamed={invalidateMusicQueries} />
                        </div>
                      </>
                    ) : null}
                  </div>
                </Fragment>
              ))
            ) : (
              <p className="p-3 text-sm text-muted-foreground">暂无艺术家。</p>
            )}
          </div>
          <Pagination page={page} total={paged?.total ?? 0} pageSize={50} loading={pagedLoading} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
function ArtistEditor(props: { id: string; onRenamed: () => void }) {
  const { data: detail, refetch } = useQuery({
    queryKey: ['admin.artists:detail', props.id],
    queryFn: () => api.admin.artists.detail(props.id),
  });
  const [name, setName] = useState('');
  const [avatarKey, setAvatarKey] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  useEffect(() => {
    const d = detail;
    if (d) {
      setName(d.name);
      setAvatarKey(d.avatarKey ?? '');
    }
  }, [detail]);
  async function save() {
    await api.admin.artists.update(props.id, {
      name: name,
      avatarKey: avatarKey,
    });
    props.onRenamed();
    void refetch();
  }
  async function addAlias() {
    if (!aliasInput.trim()) return;
    await api.admin.artists.addAlias(props.id, aliasInput.trim());
    void invalidateMusicQueries();
    setAliasInput('');
    void refetch();
  }
  async function delAlias(aid: string) {
    await api.admin.artists.deleteAlias(props.id, aid);
    void invalidateMusicQueries();
    void refetch();
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">名称</div>
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">头像 key（对象存储）</div>
          <Input value={avatarKey} onChange={(e) => setAvatarKey(e.currentTarget.value)} />
        </div>
      </div>
      <Button size="sm" onClick={save}>
        保存
      </Button>

      <div className="space-y-2">
        <div className="text-sm font-medium">别名</div>
        <div className="flex flex-wrap gap-1.5">
          {(detail?.aliases ?? []).length ? (
            (detail?.aliases ?? []).map((al, index) => (
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

      <div className="text-xs text-muted-foreground">
        关联专辑：
        {(detail?.albums ?? []).map((al) => al.title).join('、') || '无'} · 曲目数 {detail?.trackCount ?? 0}
      </div>
      <div className="space-y-2 rounded-none border p-3">
        <p className="text-sm">艺术家 ID：{props.id}。合并会转移曲目、专辑、演出和别名。</p>
        <Input
          placeholder="目标艺术家 ID"
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.currentTarget.value)}
        />
        <Button
          variant="outline"
          disabled={!mergeTarget.trim()}
          onClick={async () => {
            if (!confirm('确认合并艺术家？此操作不可撤销。')) return;
            await api.admin.artists.merge(props.id, mergeTarget.trim());
            props.onRenamed();
          }}
        >
          合并艺术家
        </Button>
      </div>
    </div>
  );
}
