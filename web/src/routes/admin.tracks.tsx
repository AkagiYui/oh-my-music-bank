import { TrackFilters } from '../components/TrackFilters';
import { Pagination } from '../components/Pagination';
/** 路由 `/admin/tracks` —— 曲目管理：列表 + 完整编辑（基础信息、别名、艺术家、专辑、语种、音频）。 */
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api, type MetaSong } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent } from '../components/ui/card';
import { EntityPicker, type Entity } from '../components/admin/EntityPicker';
import { AudioPlayer } from '../components/AudioPlayer';
import { formatDuration } from '../lib/utils';

export const Route = createFileRoute('/admin/tracks')({
  component: TracksPage,
});

const artistSearch = (q: string): Promise<Entity[]> =>
  api.admin.artists.list(q).then((r) => r.data.map((a) => ({ id: a.id, name: a.name })));
const artistCreate = (name: string): Promise<Entity> =>
  api.admin.artists.create(name).then((a) => ({ id: a.id, name: a.name }));
const albumSearch = (q: string): Promise<Entity[]> =>
  api.admin.albums.list(q).then((r) => r.data.map((a) => ({ id: a.id, name: a.title })));
const albumCreate = (name: string): Promise<Entity> =>
  api.admin.albums.create(name).then((a) => ({ id: a.id, name: a.title }));

function TracksPage() {
  const [q, setQ] = createSignal('');
  const [filters, setFilters] = createSignal<Record<string, string>>({});
  const [activeFilters, setActiveFilters] = createSignal<Record<string, string>>({});
  const [term, setTerm] = createSignal('');
  const [page, setPage] = createSignal(1);
  const [paged, { refetch }] = createResource(
    () => ({ term: term(), page: page(), filters: activeFilters() }),
    (p) => api.admin.tracks.list(p.term, p.page, p.filters),
  );
  const list = () => paged()?.data;
  const [editing, setEditing] = createSignal<string | null>(null);

  async function remove(id: string) {
    if (!confirm('确认删除该曲目？相关音频与对象也会被清理。')) return;
    await api.admin.tracks.remove(id);
    if (editing() === id) setEditing(null);
    refetch();
  }

  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-semibold">曲目管理</h1>
      <Card>
        <CardContent class="space-y-4 p-4">
          <TrackFilters value={filters()} onChange={setFilters} />
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setActiveFilters(filters());
              setTerm(q().trim());
            }}
          >
            <Input
              placeholder="搜索标题、别名、艺术家或专辑"
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
            />
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>

          <div class="divide-y rounded-md border">
            <For each={list() ?? []} fallback={<p class="p-3 text-sm text-muted-foreground">暂无曲目。</p>}>
              {(t) => (
                <div>
                  <div class="flex items-center gap-3 p-3 text-sm">
                    <Show when={t.coverUrl} fallback={<div class="size-10 shrink-0 rounded bg-muted" />}>
                      <img src={t.coverUrl} alt="" class="size-10 shrink-0 rounded object-cover" />
                    </Show>
                    <div class="min-w-0">
                      <div class="truncate font-medium">{t.title}</div>
                      <div class="truncate text-xs text-muted-foreground">
                        {t.artists.map((a) => a.name).join(' / ') || '未知艺术家'} · {formatDuration(t.duration)}
                      </div>
                    </div>
                    <div class="ml-auto flex items-center gap-2">
                      <Show
                        when={t.available}
                        fallback={
                          <span class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">已下架</span>
                        }
                      >
                        <span class="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-600">可搜索</span>
                      </Show>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(editing() === t.id ? null : t.id)}>
                        {editing() === t.id ? '收起' : '编辑'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
                        删除
                      </Button>
                    </div>
                  </div>
                  <Show when={editing() === t.id}>
                    <div class="border-t bg-muted/30 p-4">
                      <TrackEditor id={t.id} onChanged={refetch} />
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

function TrackEditor(props: { id: string; onChanged: () => void }) {
  const [detail, { refetch }] = createResource(() => api.admin.tracks.detail(props.id));
  const [languages] = createResource(() => api.admin.languages.list());

  const [title, setTitle] = createSignal('');
  const [duration, setDuration] = createSignal(0);
  const [available, setAvailable] = createSignal(true);
  const [lyric, setLyric] = createSignal('');
  const [lrc, setLrc] = createSignal('');
  const [aliasInput, setAliasInput] = createSignal('');
  const [artists, setArtists] = createSignal<Entity[]>([]);
  const [albums, setAlbums] = createSignal<Entity[]>([]);
  const [langIds, setLangIds] = createSignal<number[]>([]);

  createEffect(() => {
    const d = detail();
    if (!d) return;
    setTitle(d.title);
    setDuration(d.duration);
    setAvailable(d.available);
    setLyric(d.lyric ?? '');
    setLrc(d.lrcLyric ?? '');
    setArtists(d.artists.map((a) => ({ id: a.id, name: a.name })));
    setAlbums((d.albums ?? []).map((a) => ({ id: a.id, name: a.title })));
    setLangIds((d.languages ?? []).map((l) => l.id));
  });

  const [metaQ, setMetaQ] = createSignal('');
  const [metaResults, setMetaResults] = createSignal<MetaSong[]>([]);
  const [metaBusy, setMetaBusy] = createSignal(false);
  const [mergeTarget, setMergeTarget] = createSignal('');
  const [metaFields, setMetaFields] = createSignal<string[]>([
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
      setMetaResults(await api.admin.metadata.search(metaQ().trim() || title() || ''));
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
        Object.fromEntries(Object.entries(values).filter(([key]) => metaFields().includes(key))),
      );
      setMetaResults([]);
      refetch();
      props.onChanged();
    } finally {
      setMetaBusy(false);
    }
  }

  async function saveBasics() {
    await api.admin.tracks.update(props.id, {
      title: title(),
      duration: duration(),
      available: available(),
      lyric: lyric(),
      lrcLyric: lrc(),
    });
    props.onChanged();
    refetch();
  }
  async function addAlias() {
    if (!aliasInput().trim()) return;
    await api.admin.tracks.addAlias(props.id, aliasInput().trim());
    setAliasInput('');
    refetch();
  }
  async function delAlias(aid: string) {
    await api.admin.tracks.deleteAlias(props.id, aid);
    refetch();
  }
  async function changeArtists(items: Entity[]) {
    setArtists(items);
    await api.admin.tracks.setArtists(
      props.id,
      items.map((i) => i.id),
    );
  }
  async function changeAlbums(items: Entity[]) {
    setAlbums(items);
    await api.admin.tracks.setAlbums(
      props.id,
      items.map((i) => i.id),
    );
  }
  async function toggleLang(id: number, checked: boolean) {
    const next = checked ? [...langIds(), id] : langIds().filter((x) => x !== id);
    setLangIds(next);
    await api.admin.tracks.setLanguages(props.id, next);
  }
  async function delAudio(aid: string) {
    if (!confirm('删除该音质音频？')) return;
    await api.admin.audio.remove(aid);
    refetch();
  }

  return (
    <div class="space-y-5">
      {/* 匹配元信息（网易云） */}
      <div class="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
        <div class="text-sm font-medium">匹配元信息（仅覆盖选中字段）</div>
        <div class="flex flex-wrap gap-2 text-xs">
          <For
            each={[
              ['title', '标题'],
              ['artists', '艺术家'],
              ['album', '专辑'],
              ['lyric', '歌词'],
              ['lrcLyric', 'LRC'],
              ['coverUrl', '封面'],
            ]}
          >
            {([key, label]) => (
              <label>
                <input
                  type="checkbox"
                  checked={metaFields().includes(key)}
                  onChange={(e) =>
                    setMetaFields((v) => (e.currentTarget.checked ? [...v, key] : v.filter((x) => x !== key)))
                  }
                />{' '}
                {label}
              </label>
            )}
          </For>
        </div>
        <div class="flex gap-2">
          <Input
            class="h-9"
            placeholder="按歌名搜索（默认用当前标题）"
            value={metaQ()}
            onInput={(e) => setMetaQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                searchMeta();
              }
            }}
          />
          <Button size="sm" variant="secondary" disabled={metaBusy()} onClick={searchMeta}>
            {metaBusy() ? '…' : '搜索'}
          </Button>
        </div>
        <Show when={metaResults().length > 0}>
          <div class="max-h-56 divide-y overflow-auto rounded-md border bg-background">
            <For each={metaResults()}>
              {(m) => (
                <div class="flex items-center gap-2 p-2 text-sm">
                  <Show when={m.coverUrl} fallback={<div class="size-9 shrink-0 rounded bg-muted" />}>
                    <img
                      src={m.coverUrl}
                      alt=""
                      class="size-9 shrink-0 rounded object-cover"
                      referrerpolicy="no-referrer"
                    />
                  </Show>
                  <div class="min-w-0">
                    <div class="truncate font-medium">{m.title}</div>
                    <div class="truncate text-xs text-muted-foreground">
                      {m.artists.join(' / ')} · {m.album}
                    </div>
                  </div>
                  <Button size="sm" class="ml-auto" disabled={metaBusy()} onClick={() => applyMeta(m.id)}>
                    应用
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* 基础信息 */}
      <div class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <div class="text-sm font-medium">标题</div>
            <Input value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
          </div>
          <div class="space-y-1.5">
            <div class="text-sm font-medium">时长（秒）</div>
            <Input type="number" value={duration()} onInput={(e) => setDuration(Number(e.currentTarget.value))} />
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="size-4"
            checked={available()}
            onChange={(e) => setAvailable(e.currentTarget.checked)}
          />
          可被搜索
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <div class="text-sm font-medium">歌词（纯文本）</div>
            <Textarea rows={4} value={lyric()} onInput={(e) => setLyric(e.currentTarget.value)} />
          </div>
          <div class="space-y-1.5">
            <div class="text-sm font-medium">LRC 歌词</div>
            <Textarea rows={4} value={lrc()} onInput={(e) => setLrc(e.currentTarget.value)} />
          </div>
        </div>
        <Button size="sm" onClick={saveBasics}>
          保存基础信息
        </Button>
      </div>

      {/* 别名 */}
      <div class="space-y-2">
        <div class="text-sm font-medium">别名</div>
        <div class="flex flex-wrap gap-1.5">
          <For each={detail()?.aliasRows ?? []} fallback={<span class="text-xs text-muted-foreground">（无）</span>}>
            {(al) => (
              <span class="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                {al.alias}
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground"
                  onClick={() => delAlias(al.id)}
                >
                  ×
                </button>
              </span>
            )}
          </For>
        </div>
        <div class="flex gap-2">
          <Input
            class="h-9"
            placeholder="添加别名"
            value={aliasInput()}
            onInput={(e) => setAliasInput(e.currentTarget.value)}
          />
          <Button size="sm" variant="secondary" onClick={addAlias}>
            添加
          </Button>
        </div>
      </div>

      {/* 艺术家 / 专辑 */}
      <EntityPicker
        label="艺术家"
        selected={artists()}
        search={artistSearch}
        onChange={changeArtists}
        allowCreate={artistCreate}
      />
      <EntityPicker
        label="专辑"
        selected={albums()}
        search={albumSearch}
        onChange={changeAlbums}
        allowCreate={albumCreate}
      />

      {/* 语种 */}
      <div class="space-y-2">
        <div class="text-sm font-medium">语种</div>
        <div class="flex flex-wrap gap-3">
          <For each={languages() ?? []}>
            {(l) => (
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  class="size-4"
                  checked={langIds().includes(l.id)}
                  onChange={(e) => toggleLang(l.id, e.currentTarget.checked)}
                />
                {l.name}
              </label>
            )}
          </For>
        </div>
      </div>

      {/* 分发音频 */}
      <div class="space-y-2">
        <div class="text-sm font-medium">分发音频 · 曲目 ID：{props.id}</div>
        <Show when={(detail()?.audios ?? []).length > 0} fallback={<p class="text-xs text-muted-foreground">无</p>}>
          <AudioPlayer
            sources={(detail()?.audios ?? []).map((au) => ({
              id: au.id,
              label: `${au.qualityLabel} · ${Math.round(au.bitrate / 1000)}kbps`,
              url: au.url,
              loudness: au.loudness,
            }))}
          />
          <div class="divide-y rounded-md border text-xs">
            <For each={detail()?.audios ?? []}>
              {(au) => (
                <div class="flex flex-wrap items-center gap-2 p-2">
                  <span class="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">{au.qualityLabel}</span>
                  <span class="text-muted-foreground">
                    {au.source ? `${au.source} · ` : ''}
                    {au.format} · {Math.round(au.bitrate / 1000)} kbps · {au.samplingRate} Hz ·{' '}
                    {(au.size / 1048576).toFixed(1)} MB
                    {au.loudness != null ? ` · ${au.loudness.toFixed(1)} LUFS` : ''}
                  </span>
                  <Button size="sm" variant="ghost" class="ml-auto h-6" onClick={() => delAudio(au.id)}>
                    删除
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* 原始音频 */}
      <div class="space-y-2">
        <div class="text-sm font-medium">原始音频</div>
        <For each={detail()?.origins ?? []} fallback={<p class="text-xs text-muted-foreground">无</p>}>
          {(o) => (
            <div class="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
              <span class="rounded bg-muted px-2 py-0.5">{o.status}</span>
              <span class="text-muted-foreground">
                {o.format} · {Math.round(o.bitrate / 1000)} kbps · {(o.size / 1048576).toFixed(1)} MB
              </span>
              <code class="text-muted-foreground">{o.hash.slice(0, 12)}…</code>
            </div>
          )}
        </For>
      </div>
      <div class="space-y-2 rounded border p-3">
        <p class="text-sm">合并至已有曲目：保留目标基础信息，转移全部音频、关联和别名，然后删除当前曲目。</p>
        <Input placeholder="目标曲目 ID" value={mergeTarget()} onInput={(e) => setMergeTarget(e.currentTarget.value)} />
        <Button
          variant="outline"
          disabled={!mergeTarget().trim()}
          onClick={async () => {
            if (!confirm('确认合并？此操作不可撤销。')) return;
            await api.admin.tracks.merge(props.id, mergeTarget().trim());
            props.onChanged();
          }}
        >
          合并曲目
        </Button>
      </div>
    </div>
  );
}
