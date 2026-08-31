import { queryClient } from './query-client';

function invalidate(...keys: string[]) {
  // 只指定查询首段，让所有页码、搜索词和筛选组合一起失效；未挂载页面下次进入时更新。
  return Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

export function invalidateMusicQueries() {
  return Promise.all([
    invalidate('admin.tracks:paged', 'admin.artists:paged', 'admin.albums:paged', 'admin.index:stats'),
    // 关联修改也会影响详情，但不能自动回填当前编辑器、覆盖其他尚未保存的字段。
    // 当前编辑器按原有保存流程主动 refetch；其余详情重新打开时会获取最新数据。
    ...['admin.tracks:detail', 'admin.artists:detail', 'admin.albums:detail'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key], refetchType: 'none' }),
    ),
  ]);
}

export function invalidateApiKeyQueries() {
  return invalidate('dashboard:paged', 'admin.api-keys:paged', 'admin.index:stats');
}

export function invalidateUserQueries() {
  // 删除用户也会删除其 API Key。
  return Promise.all([invalidate('admin.users:paged'), invalidateApiKeyQueries()]);
}

export function invalidateIntegrationQueries() {
  return invalidate(
    'admin.integrations:cfg',
    'bilibili:accounts',
    'admin.import:status',
    'admin.import:folders',
    'admin.import:streamUrl',
  );
}

export function invalidateJobQueries() {
  return Promise.all([invalidate('admin.jobs:jobs'), invalidateMusicQueries()]);
}
