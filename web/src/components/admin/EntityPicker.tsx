/** 通用实体选择器：以 chip 展示已选项，支持搜索添加与（可选）新建。用于曲目关联艺术家/专辑等。 */
import { For, Show, createSignal } from 'solid-js';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export interface Entity {
  id: string;
  name: string;
}

export function EntityPicker(props: {
  label: string;
  selected: Entity[];
  search: (q: string) => Promise<Entity[]>;
  onChange: (items: Entity[]) => void;
  allowCreate?: (name: string) => Promise<Entity>;
}) {
  const [q, setQ] = createSignal('');
  const [results, setResults] = createSignal<Entity[]>([]);

  async function doSearch() {
    const term = q().trim();
    if (!term) {
      setResults([]);
      return;
    }
    setResults(await props.search(term));
  }
  function add(e: Entity) {
    if (!props.selected.some((s) => s.id === e.id)) props.onChange([...props.selected, e]);
    setQ('');
    setResults([]);
  }
  function remove(id: string) {
    props.onChange(props.selected.filter((s) => s.id !== id));
  }
  async function create() {
    if (!props.allowCreate || !q().trim()) return;
    add(await props.allowCreate(q().trim()));
  }

  return (
    <div class="space-y-2">
      <div class="text-sm font-medium">{props.label}</div>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.selected} fallback={<span class="text-xs text-muted-foreground">（空）</span>}>
          {(e) => (
            <span class="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
              {e.name}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                onClick={() => remove(e.id)}
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
          placeholder={`搜索${props.label}…`}
          value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSearch();
            }
          }}
        />
        <Button type="button" size="sm" variant="secondary" onClick={doSearch}>
          搜索
        </Button>
        <Show when={props.allowCreate}>
          <Button type="button" size="sm" variant="outline" onClick={create}>
            新建
          </Button>
        </Show>
      </div>
      <Show when={results().length > 0}>
        <div class="max-h-40 divide-y overflow-auto rounded-md border">
          <For each={results()}>
            {(e) => (
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => add(e)}
              >
                {e.name}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
