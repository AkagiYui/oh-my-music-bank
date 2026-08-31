import { Button } from './ui/button';
export function Pagination(props: {
  page: number;
  total: number;
  pageSize: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  const pages = () => Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <div class="flex items-center justify-end gap-3 text-sm">
      <span>
        共 {props.total} 条 · {props.page} / {pages()}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={props.loading || props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        上一页
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={props.loading || props.page >= pages()}
        onClick={() => props.onPage(props.page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}
