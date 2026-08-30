/** 路由 `/admin/artists` —— 艺术家管理（列表、新建、编辑名称/别名）。 */
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';

export const Route = createFileRoute('/admin/artists')({
  component: ArtistsPage,
});

function ArtistsPage() {
  const [q, setQ] = createSignal('');
  const [term, setTerm] = createSignal('');
  const [list, { refetch }] = createResource(term, (t) => api.admin.artists.list(t).then((r) => r.data));
  const [newName, setNewName] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);

  async function create() {
    if (!newName().trim()) return;
    await api.admin.artists.create(newName().trim());
    setNewName('');
    refetch();
  }
  async function remove(id: string) {
    if (!confirm('删除该艺术家？')) return;
    await api.admin.artists.remove(id);
    if (editing() === id) setEditing(null);
    refetch();
  }

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">艺术家管理</h1>
      <Card>
        <CardContent class="space-y-4 p-4">
          <div class="flex flex-wrap gap-2">
            <form
              class="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setTerm(q().trim());
              }}
            >
              <Input placeholder="搜索艺术家" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
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
              <Input placeholder="新建艺术家名" value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} />
              <Button type="submit">新建</Button>
            </form>
          </div>

          <div class="divide-y rounded-md border">
            <For each={list() ?? []} fallback={<p class="p-3 text-sm text-muted-foreground">暂无艺术家。</p>}>
              {(a) => (
                <div>
                  <div class="flex items-center gap-3 p-3 text-sm">
                    <Show when={a.avatarUrl} fallback={<div class="size-9 shrink-0 rounded-full bg-muted" />}>
                      <img src={a.avatarUrl} alt="" class="size-9 shrink-0 rounded-full object-cover" />
                    </Show>
                    <div class="min-w-0">
                      <div class="truncate font-medium">{a.name}</div>
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
                      <ArtistEditor id={a.id} onRenamed={refetch} />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArtistEditor(props: { id: string; onRenamed: () => void }) {
  const [detail, { refetch }] = createResource(() => api.admin.artists.detail(props.id));
  const [name, setName] = createSignal('');
  const [avatarKey, setAvatarKey] = createSignal('');
  const [aliasInput, setAliasInput] = createSignal('');

  createEffect(() => {
    const d = detail();
    if (d) {
      setName(d.name);
      setAvatarKey(d.avatarKey ?? '');
    }
  });

  async function save() {
    await api.admin.artists.update(props.id, { name: name(), avatarKey: avatarKey() });
    props.onRenamed();
    refetch();
  }
  async function addAlias() {
    if (!aliasInput().trim()) return;
    await api.admin.artists.addAlias(props.id, aliasInput().trim());
    setAliasInput('');
    refetch();
  }
  async function delAlias(aid: string) {
    await api.admin.artists.deleteAlias(props.id, aid);
    refetch();
  }

  return (
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <div class="text-sm font-medium">名称</div>
          <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </div>
        <div class="space-y-1.5">
          <div class="text-sm font-medium">头像 key（对象存储）</div>
          <Input value={avatarKey()} onInput={(e) => setAvatarKey(e.currentTarget.value)} />
        </div>
      </div>
      <Button size="sm" onClick={save}>
        保存
      </Button>

      <div class="space-y-2">
        <div class="text-sm font-medium">别名</div>
        <div class="flex flex-wrap gap-1.5">
          <For each={detail()?.aliases ?? []} fallback={<span class="text-xs text-muted-foreground">（无）</span>}>
            {(al) => (
              <span class="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                {al.alias}
                <button type="button" class="text-muted-foreground hover:text-foreground" onClick={() => delAlias(al.id)}>
                  ×
                </button>
              </span>
            )}
          </For>
        </div>
        <div class="flex gap-2">
          <Input class="h-9" placeholder="添加别名" value={aliasInput()} onInput={(e) => setAliasInput(e.currentTarget.value)} />
          <Button size="sm" variant="secondary" onClick={addAlias}>
            添加
          </Button>
        </div>
      </div>

      <div class="text-xs text-muted-foreground">
        关联专辑：{(detail()?.albums ?? []).map((al) => al.title).join('、') || '无'} · 曲目数 {detail()?.trackCount ?? 0}
      </div>
    </div>
  );
}
