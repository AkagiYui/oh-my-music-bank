import { useState, Fragment } from 'react';
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
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Entity[]>([]);
  async function doSearch() {
    const term = q.trim();
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
    if (!props.allowCreate || !q.trim()) return;
    add(await props.allowCreate(q.trim()));
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{props.label}</div>
      <div className="flex flex-wrap gap-1.5">
        {(props.selected ?? []).length ? (
          (props.selected ?? []).map((e, index) => (
            <Fragment key={e.id}>
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                {e.name}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => remove(e.id)}
                >
                  ×
                </button>
              </span>
            </Fragment>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">（空）</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          className="h-9"
          placeholder={`搜索${props.label}…`}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
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
        {props.allowCreate ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={create}>
              新建
            </Button>
          </>
        ) : null}
      </div>
      {results.length > 0 ? (
        <>
          <div className="max-h-40 divide-y overflow-auto rounded-md border">
            {(results ?? []).map((e, index) => (
              <Fragment key={e.name}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => add(e)}
                >
                  {e.name}
                </button>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
