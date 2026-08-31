import { Pagination } from '../components/Pagination';
/** 路由 `/admin/albums` —— 专辑管理（列表、新建、编辑标题/封面/艺术家）。 */
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { EntityPicker, type Entity } from '../components/admin/EntityPicker';
import { formatDuration } from '../lib/utils';

export const Route = createFileRoute('/admin/albums')({
  component: AlbumsPage,
});

const artistSearch = (q: string): Promise<Entity[]> =>
  api.admin.artists.list(q).then((r) => r.data.map((a) => ({ id: a.id, name: a.name })));
const artistCreate = (name: string): Promise<Entity> =>
  api.admin.artists.create(name).then((a) => ({ id: a.id, name: a.name }));

function AlbumsPage() {
  const [q, setQ] = createSignal('');
  const [term, setTerm] = createSignal('');
  const [page, setPage] = createSignal(1);
  const [paged, { refetch }] = createResource(
    () => ({ term: term(), page: page() }),
    (p) => api.admin.albums.list(p.term, p.page),
  );
  const list = () => paged()?.data;
  const [newTitle, setNewTitle] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);

  async function create() {
    if (!newTitle().trim()) return;
    await api.admin.albums.create(newTitle().trim());
    setNewTitle('');
    refetch();
  }
  async function remove(id: string) {
    if (!confirm('删除该专辑？')) return;
    await api.admin.albums.remove(id);
    if (editing() === id) setEditing(null);
    refetch();
  }

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">专辑管理</h1>
      <Card>
        <CardContent class="space-y-4 p-4">
          <div class="flex flex-wrap gap-2">
            <form
              class="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setTerm(q().trim());
              }}
            >
              <Input placeholder="搜索专辑" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
              <Button type="submit" variant="secondary">
                搜索
              </Button>
            </form>
            <form
              class="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <Input placeholder="新建专辑名" value={newTitle()} onInput={(e) => setNewTitle(e.currentTarget.value)} />
              <Button type="submit">新建</Button>
            </form>
          </div>

          <div class="divide-y rounded-md border">
            <For each={list() ?? []} fallback={<p class="p-3 text-sm text-muted-foreground">暂无专辑。</p>}>
              {(a) => (
                <div>
                  <div class="flex items-center gap-3 p-3 text-sm">
                    <Show when={a.coverUrl} fallback={<div class="size-9 shrink-0 rounded bg-muted" />}>
                      <img src={a.coverUrl} alt="" class="size-9 shrink-0 rounded object-cover" />
                    </Show>
                    <div class="min-w-0">
                      <div class="truncate font-medium">{a.title}</div>
                      <div class="text-xs text-muted-foreground">{a.trackCount} 首曲目</div>
                    </div>
                    <div class="ml-auto flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(editing() === a.id ? null : a.id)}>
                        {editing() === a.id ? '收起' : '编辑'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>
                        删除
                      </Button>
                    </div>
                  </div>
                  <Show when={editing() === a.id}>
                    <div class="border-t bg-muted/30 p-4">
                      <AlbumEditor id={a.id} onRenamed={refetch} />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Pagination
            page={page()}
            total={paged()?.total ?? 0}
            pageSize={50}
            loading={paged.loading}
            onPage={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function AlbumEditor(props: { id: string; onRenamed: () => void }) {
  const [detail, { refetch }] = createResource(() => api.admin.albums.detail(props.id));
  const [title, setTitle] = createSignal('');
  const [coverKey, setCoverKey] = createSignal('');
  const [artists, setArtists] = createSignal<Entity[]>([]);
  const [order, setOrder] = createSignal<{ id: string; title: string; trackNo: number; discNo: number }[]>([]);

  createEffect(() => {
    const d = detail();
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
  });

  async function save() {
    await api.admin.albums.update(props.id, {
      title: title(),
      coverKey: coverKey(),
    });
    props.onRenamed();
    refetch();
  }
  async function changeArtists(items: Entity[]) {
    setArtists(items);
    await api.admin.albums.setArtists(
      props.id,
      items.map((i) => i.id),
    );
  }

  return (
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <div class="text-sm font-medium">标题</div>
          <Input value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
        </div>
        <div class="space-y-1.5">
          <div class="text-sm font-medium">封面 key（对象存储）</div>
          <Input value={coverKey()} onInput={(e) => setCoverKey(e.currentTarget.value)} />
        </div>
      </div>
      <Button size="sm" onClick={save}>
        保存
      </Button>

      <EntityPicker
        label="艺术家"
        selected={artists()}
        search={artistSearch}
        onChange={changeArtists}
        allowCreate={artistCreate}
      />

      <div class="space-y-1">
        <div class="text-sm font-medium">曲目（{detail()?.tracks.length ?? 0}）</div>
        <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <For each={detail()?.tracks ?? []} fallback={<span>无</span>}>
            {(t) => (
              <span class="rounded border px-2 py-0.5">
                {t.title} · {formatDuration(t.duration)}
              </span>
            )}
          </For>
        </div>
      </div>
      <div class="space-y-2">
        <p class="text-sm">编辑曲序与碟号</p>
        <For each={order()}>
          {(t, i) => (
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate">{t.title}</span>
              <Input
                class="w-20"
                type="number"
                min="1"
                aria-label="碟号"
                value={t.discNo}
                onInput={(e) => {
                  const n = Number(e.currentTarget.value);
                  setOrder((v) => v.map((x, k) => (k === i() ? { ...x, discNo: n } : x)));
                }}
              />
              <Input
                class="w-20"
                type="number"
                min="1"
                aria-label="曲序"
                value={t.trackNo}
                onInput={(e) => {
                  const n = Number(e.currentTarget.value);
                  setOrder((v) => v.map((x, k) => (k === i() ? { ...x, trackNo: n } : x)));
                }}
              />
            </div>
          )}
        </For>
        <Button
          size="sm"
          onClick={async () => {
            await api.admin.albums.orderTracks(props.id, order());
            refetch();
          }}
        >
          保存曲序
        </Button>
      </div>
    </div>
  );
}
