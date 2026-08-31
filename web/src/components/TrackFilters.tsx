import { NativeSelect } from './ui/native-select';
import { Input } from './ui/input';
export function TrackFilters(props: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const set = (key: string, value: string) => props.onChange({ ...props.value, [key]: value });
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Input
        placeholder="专辑筛选"
        value={props.value.album ?? ''}
        onChange={(e) => set('album', e.currentTarget.value)}
      />
      <Input
        placeholder="语种筛选"
        value={props.value.language ?? ''}
        onChange={(e) => set('language', e.currentTarget.value)}
      />
      <NativeSelect
        className="h-9 rounded border bg-background px-2 text-sm"
        aria-label="音质筛选"
        value={props.value.quality ?? ''}
        onChange={(e) => set('quality', e.currentTarget.value)}
      >
        <option value="">全部音质</option>
        <option value="standard">标准</option>
        <option value="high">高音质</option>
        <option value="lossless">无损</option>
      </NativeSelect>
    </div>
  );
}
