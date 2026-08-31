import { test, expect } from '@playwright/test';
import { mockApp, track } from './fixtures';

test('站内切换、已访问分页和详情重新展开复用缓存', async ({ page }) => {
  const app = await mockApp(page);
  const count = (path: string) => app.requests.filter((r) => r.method === 'GET' && r.path === path).length;
  await page.goto('/music/tracks');
  await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '可被搜索' })).toBeChecked();
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '可被搜索' })).toBeChecked();
  expect(count(`/api/v1/admin/tracks/${track.id}`)).toBe(1);

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('第二页曲目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
  expect(count('/api/v1/admin/tracks')).toBe(2);

  // 必须点击 SPA 链接；page.goto 会重新建立 QueryClient，不能验证路由缓存。
  await page.getByRole('link', { name: '艺术家', exact: true }).click();
  await expect(page.getByText('测试艺术家', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '曲目', exact: true }).click();
  await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '艺术家', exact: true }).click();
  await expect(page.getByText('测试艺术家', { exact: true })).toBeVisible();
  expect(count('/api/v1/admin/tracks')).toBe(2);
  expect(count('/api/v1/admin/artists')).toBe(1);
  app.assertNoErrors();
});

test('缓存过期后先显示数据，后台刷新不禁用已有分页', async ({ page }) => {
  const app = await mockApp(page);
  const now = Date.now();
  await page.clock.setFixedTime(now);
  await page.goto('/music/tracks');
  await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '艺术家', exact: true }).click();
  await expect(page.getByText('测试艺术家', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(now + 6 * 60_000);

  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  let refreshing = false;
  await page.route('**/api/v1/admin/tracks?*', async (route) => {
    refreshing = true;
    await pending;
    await route.fulfill({ json: { data: [{ ...track, title: '刷新后的曲目' }], total: 101, page: 1, pageSize: 50 } });
  });
  try {
    await page.getByRole('link', { name: '曲目', exact: true }).click();
    await expect.poll(() => refreshing).toBe(true);
    await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
    await expect(page.getByText('暂无曲目。')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  } finally {
    release();
  }
  await expect(page.getByText('刷新后的曲目', { exact: true })).toBeVisible();
  app.assertNoErrors();
});

test('删除曲目后刷新当前页，并让之前访问的分页和关联列表失效', async ({ page }) => {
  const app = await mockApp(page);
  let deleted = false;
  const pages: number[] = [];
  await page.route('**/api/v1/admin/tracks**', async (route) => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      deleted = true;
      await route.fulfill({ json: { data: {} } });
      return;
    }
    const current = Number(new URL(request.url()).searchParams.get('page'));
    pages.push(current);
    const title = deleted ? `更新后的第${current}页` : `原来的第${current}页`;
    await route.fulfill({ json: { data: [{ ...track, title }], total: 101, page: current, pageSize: 50 } });
  });
  await page.goto('/music/artists');
  await expect(page.getByText('测试艺术家', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '曲目', exact: true }).click();
  await expect(page.getByText('原来的第1页')).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('原来的第2页')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('更新后的第2页')).toBeVisible();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('更新后的第1页')).toBeVisible();
  expect(pages).toEqual([1, 2, 2, 1]);
  await page.getByRole('link', { name: '艺术家', exact: true }).click();
  await expect.poll(() => app.requests.filter((r) => r.path === '/api/v1/admin/artists').length).toBe(2);
  app.assertNoErrors();
});

test('退出再登录后不会复用上一会话的私有缓存', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/music/tracks');
  await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('邮箱').fill('admin@example.test');
  await page.getByLabel('密码').fill('test-password');
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('banner').getByRole('link', { name: '曲库管理', exact: true }).click();
  await page.getByRole('link', { name: '曲目', exact: true }).click();
  await expect(page.getByText('测试曲目', { exact: true })).toBeVisible();
  expect(app.requests.filter((r) => r.method === 'GET' && r.path === '/api/v1/admin/tracks')).toHaveLength(2);
  app.assertNoErrors();
});
