import { test, expect } from '@playwright/test';
import { mockApp } from './fixtures';

const musicPages = [
  ['tracks', '曲目', '曲目管理'],
  ['artists', '艺术家', '艺术家管理'],
  ['albums', '专辑', '专辑管理'],
  ['upload', '上传音频', '批量上传音频'],
  ['import', '哔哩哔哩导入', '从哔哩哔哩导入'],
  ['jobs', '收录任务', '收录任务'],
] as const;

test('曲库和系统管理独立导航、统计与页面标题', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  const systemNav = page.getByRole('navigation', { name: '系统管理', exact: true });
  await expect(systemNav.getByRole('link')).toHaveText(['概览', 'API Key', '调用日志', '用户', '站点设置', '集成']);
  await expect(page.getByRole('main').getByText('分发音频', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('近 30 天 API 调用量')).toBeVisible();

  await page.getByRole('banner').getByRole('link', { name: '曲库管理', exact: true }).click();
  await expect(page).toHaveURL(/\/music$/);
  await expect(page).toHaveTitle('概览 · Music Bank');
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '系统管理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('API Key', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('分发音频', { exact: true })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: '曲库管理', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const musicNav = page.getByRole('navigation', { name: '曲库管理', exact: true });
  await expect(musicNav.getByRole('link')).toHaveCount(7);
  for (const [path, label, heading] of musicPages) {
    await musicNav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`/music/${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${label} · Music Bank`);
    await expect(musicNav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(musicNav.getByRole('link', { name: '概览', exact: true })).not.toHaveAttribute('aria-current');
  }
  await page.getByRole('banner').getByRole('link', { name: '系统管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  app.assertNoErrors();
});

test('旧业务地址跳转至曲库，保留查询参数和锚点', async ({ page }) => {
  const app = await mockApp(page);
  for (const [path, , heading] of musicPages) {
    await page.goto(`/admin/${path}?source=bookmark#content`);
    await expect(page).toHaveURL(`/music/${path}?source=bookmark#content`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '曲库管理', exact: true })).toBeVisible();
  }
  app.assertNoErrors();
});

test('上传与导入页的任务链接指向独立曲库页面', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/music/upload');
  await page.getByRole('main').getByRole('link', { name: '查看处理进度、失败记录和重试', exact: true }).click();
  await expect(page).toHaveURL('/music/jobs');
  await expect(page.getByRole('heading', { name: '收录任务', exact: true })).toBeVisible();
  await page.goto('/music/import');
  await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
  await page.getByRole('checkbox', { name: '选择 测试视频' }).check();
  await page.getByRole('button', { name: '批量导入所选视频的全部分 P' }).click();
  await page.getByRole('main').locator('a[href="/music/jobs"]').last().click();
  await expect(page).toHaveURL('/music/jobs');
  // 未配置时，导入页仍能跨管理区前往集成凭据设置。
  await page.route('**/api/v1/admin/bilibili/status', (route) =>
    route.fulfill({ json: { data: { configured: false } } }),
  );
  await page.goto('/music/import');
  await page.getByRole('link', { name: '集成配置', exact: true }).click();
  await expect(page).toHaveURL('/admin/integrations');
  await expect(page.getByRole('heading', { name: '集成配置', exact: true })).toBeVisible();
  app.assertNoErrors();
});

for (const role of ['anonymous', 'user']) {
  test(`${role} 无法通过新旧入口加载管理数据`, async ({ page }) => {
    const app = await mockApp(page, role !== 'anonymous');
    if (role === 'user') {
      await page.route('**/api/v1/auth/me', (route) =>
        route.fulfill({
          json: {
            data: { id: 'member-1', username: '普通用户', email: 'member@example.test', role: 'user', isActive: true },
          },
        }),
      );
    }
    for (const path of ['/music', ...musicPages.map(([path]) => `/music/${path}`), '/admin', '/admin/tracks']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('banner').getByRole('link', { name: /曲库管理|系统管理/ })).toHaveCount(0);
    }
    expect(app.requests.filter((r) => r.path.startsWith('/api/v1/admin/'))).toEqual([]);
    app.assertNoErrors();
  });
}
