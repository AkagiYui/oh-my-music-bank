import { NativeSelect } from '../components/ui/native-select';
import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from '../components/Pagination';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
export const Route = createFileRoute('/admin/users')({
  component: UsersPage,
});
function UsersPage() {
  const [page, setPage] = useState(1);
  const {
    data: paged,
    isFetching: pagedLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin.users:paged', page],
    queryFn: () => api.admin.users.list(page),
  });
  const users = () => paged?.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">用户管理</h1>
      <Card>
        <CardContent className="p-4">
          {(users() ?? []).length > 0 ? (
            <>
              <div className="divide-y rounded-md border">
                {(users() ?? []).map((u, index) => (
                  <Fragment key={u.id}>
                    <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.username}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <NativeSelect
                          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                          value={u.role}
                          onChange={(e) => api.admin.users.setRole(u.id, e.currentTarget.value).then(() => refetch())}
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </NativeSelect>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => api.admin.users.toggleActive(u.id, !u.isActive).then(() => refetch())}
                        >
                          {u.isActive ? '禁用' : '启用'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            confirm('确认删除该用户？') && api.admin.users.remove(u.id).then(() => refetch())
                          }
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
          <Pagination page={page} total={paged?.total ?? 0} pageSize={50} loading={pagedLoading} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
