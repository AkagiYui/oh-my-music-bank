import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';

// 空字符串仍表示不限制音质，展示文案与接口值分离。
const qualityItems = [
  { value: '', label: '全部音质' },
  { value: 'standard', label: '标准' },
  { value: 'high', label: '高音质' },
  { value: 'lossless', label: '无损' },
];
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
      <Select
        items={qualityItems}
        value={props.value.quality ?? ''}
        onValueChange={(value) => set('quality', value ?? '')}
      >
        <SelectTrigger aria-label="音质筛选" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {qualityItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
