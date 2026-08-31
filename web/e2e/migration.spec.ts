import { test, expect } from '@playwright/test';
import { mockApp, track } from './fixtures';

test('所有页面在生产构建中正常渲染，浏览器无 React 错误', async ({ page }) => {
  const app = await mockApp(page);
  for (const [path, text] of [
    ['/', '自定义音源系统'],
    ['/search', '试搜音乐'],
    ['/dashboard', '账号设置'],
    ['/admin', '概览'],
    ['/admin/upload', '批量上传音频'],
    ['/admin/jobs', '收录任务'],
    ['/admin/import', '从哔哩哔哩导入'],
    ['/admin/tracks', '曲目管理'],
    ['/admin/artists', '艺术家管理'],
    ['/admin/albums', '专辑管理'],
    ['/admin/api-keys', 'API Key 管理'],
    ['/admin/logs', '调用日志'],
    ['/admin/users', '用户管理'],
    ['/admin/settings', '站点设置'],
    ['/admin/integrations', '集成配置'],
    ['/login', '邮箱'],
    ['/register', '用户名'],
  ]) {
    await page.goto(path);
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('页面加载失败', { exact: false })).toHaveCount(0);
  }
  await page.goto('/missing-page');
  await expect(page.getByText('页面不存在（404）')).toBeVisible();
  app.assertNoErrors();
});

test('匿名管理入口不加载管理数据，登录和退出更新权限', async ({ page }) => {
  const app = await mockApp(page, false);
  await page.goto('/admin/tracks');
  await expect(page).toHaveURL(/\/$/);
  expect(app.requests.some((r) => r.path.includes('/admin/'))).toBe(false);
  await page.goto('/login');
  await page.getByLabel('邮箱').fill('admin@example.test');
  await page.getByLabel('密码').fill('test-password');
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('ommb.access'))).toBeNull();
  app.assertNoErrors();
});

test('曲目分页及编辑保留 ID、字段和 shadcn 复选框语义', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/tracks');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('第二页曲目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '可被搜索' })).toBeChecked();
  await page.getByRole('checkbox', { name: '可被搜索' }).uncheck();
  await page.getByRole('button', { name: '保存基础信息' }).click();
  await expect
    .poll(() => app.requests.find((r) => r.method === 'PUT' && r.path.endsWith(`/tracks/${track.id}`))?.body.available)
    .toBe(false);
  await page.getByRole('checkbox', { name: '歌词', exact: true }).uncheck();
  app.assertNoErrors();
});

test('专辑碟号和曲序使用当前输入提交', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/albums');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('碟号')).toHaveValue('1');
  await page.getByLabel('碟号').fill('2');
  await page.getByLabel('曲序').fill('3');
  await page.getByRole('button', { name: '保存曲序' }).click();
  await expect
    .poll(() => app.requests.find((r) => r.path.endsWith('/tracks/order'))?.body.tracks)
    .toEqual([{ id: track.id, title: track.title, trackNo: 3, discNo: 2 }]);
  app.assertNoErrors();
});

test('批量上传创建独立任务并清空成功文件', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/upload');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'a.wav', mimeType: 'audio/wav', buffer: Buffer.from('test-a') },
    { name: 'b.wav', mimeType: 'audio/wav', buffer: Buffer.from('test-b') },
  ]);
  await page.getByRole('button', { name: '上传并创建后台任务' }).click();
  await expect(page.getByRole('status')).toContainText('a.wav：已进入任务');
  await expect(page.getByRole('status')).toContainText('b.wav：已进入任务');
  expect(app.requests.filter((r) => r.path.endsWith('/jobs/upload'))).toHaveLength(2);
  await expect(page.getByRole('button', { name: '上传并创建后台任务' })).toBeDisabled();
  app.assertNoErrors();
});

test('哔哩哔哩分 P 切换和批量选中提交正确任务', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/import');
  await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
  await page.getByRole('checkbox', { name: '选择 测试视频' }).check();
  await page.getByRole('button', { name: '批量导入所选视频的全部分 P' }).click();
  await expect
    .poll(() => app.requests.find((r) => r.path.endsWith('/jobs/bilibili'))?.body.items)
    .toEqual([
      { bvid: 'BVtest', cid: 1, title: '第一段', artist: '测试 UP' },
      { bvid: 'BVtest', cid: 2, title: '第二段', artist: '测试 UP' },
    ]);
  await page.getByRole('button', { name: /测试视频.*测试 UP/ }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-1.wav');
  await page.getByRole('combobox', { name: '视频分 P' }).click();
  await page.getByRole('option', { name: 'P2 第二段 (3:00)' }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-2.wav');
  await page.getByRole('button', { name: '加入此片段' }).click();
  await expect
    .poll(() => app.requests.filter((r) => r.path.endsWith('/jobs/bilibili')).at(-1)?.body.items)
    .toEqual([{ bvid: 'BVtest', cid: 2, title: '测试视频', artist: '测试 UP', startSec: 0, endSec: 180, trackId: '' }]);
  app.assertNoErrors();
});

test('开放搜索、详情播放和分页保持可用', async ({ page }) => {
  const app = await mockApp(page, false);
  await page.goto('/search');
  await page.getByLabel('API Key').fill('omb_test');
  await page.getByPlaceholder('输入歌名 / 别名，如 告白气球').fill('测试');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: /测试曲目.*测试艺术家/ }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', 'http://127.0.0.1:5175/test-audio.wav');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('第二页曲目')).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  app.assertNoErrors();
});

test('限流数值完整输入后才提交，避免每个按键触发保存', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/api-keys');
  const rpm = page.getByRole('spinbutton');
  await rpm.fill('120');
  expect(app.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  await rpm.press('Tab');
  await expect.poll(() => app.requests.find((r) => r.method === 'PUT')?.body.rpmOverride).toBe(120);
  app.assertNoErrors();
});

test('搜索请求晚到不会覆盖重新渲染后的新结果', async ({ page }) => {
  const app = await mockApp(page, false);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  await page.route('**/api/open/v1/search?**', async (route) => {
    const old = new URL(route.request().url()).searchParams.get('q') === '旧搜索';
    if (old) {
      firstStarted();
      await gate;
    }
    await route.fulfill({
      json: { data: [{ ...track, title: old ? '旧搜索结果' : '新搜索结果' }], total: 1, page: 1, pageSize: 20 },
    });
  });
  await page.goto('/search');
  await page.getByLabel('API Key').fill('omb_test');
  const input = page.getByPlaceholder('输入歌名 / 别名，如 告白气球');
  await input.fill('旧搜索');
  await input.press('Enter');
  await started;
  await input.fill('新搜索');
  // 搜索期间仍可用表单提交新条件，旧请求的完成不得回写。
  await input.evaluate((element) => element.closest('form')!.requestSubmit());
  await expect(page.getByText('新搜索结果')).toBeVisible();
  const oldResponse = page.waitForResponse((r) => r.url().includes(encodeURIComponent('旧搜索')));
  release();
  await oldResponse;
  await expect(page.getByText('旧搜索结果')).toHaveCount(0);
  app.assertNoErrors();
});

test('手机宽度下首页和管理布局无横向溢出', async ({ page }) => {
  const app = await mockApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/admin/tracks', '/admin/jobs']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: '退出' })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth)
        .map((el) => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right }))
        .slice(0, 10),
    }));
    expect(overflow.scroll, `${path}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.width);
  }
  app.assertNoErrors();
});
