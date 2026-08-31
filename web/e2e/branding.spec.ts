import { expect, test } from '@playwright/test';
import { mockApp, defaultSiteSettings, track } from './fixtures';

const homeTitle = '听见你的收藏';

test('品牌保存即时同步全站，刷新持久化，清空可选项不会恢复旧品牌', async ({ page }, testInfo) => {
  const app = await mockApp(page);
  await page.goto('/admin/settings');
  await page.getByLabel('系统标题', { exact: true }).fill('星河音乐');
  await page.getByLabel('站点描述', { exact: true }).fill('站点元数据');
  await page.getByLabel('首页标题', { exact: true }).fill(homeTitle);
  await page.getByLabel('首页描述', { exact: true }).fill('第一行介绍\n第二行介绍');
  await page.getByLabel('Logo 地址', { exact: true }).fill('/test-cover.svg');
  await page.getByLabel('站点图标地址', { exact: true }).fill('/test-cover.svg');
  await page.getByLabel('页脚文字', { exact: true }).fill('星河工作室');
  await page.getByLabel('页脚链接', { exact: true }).fill('https://example.test/about');
  await page.getByLabel('API 独立域名', { exact: true }).fill('https://api.example.test');
  await expect(page.locator('header')).toContainText('Music Bank');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
  await expect(page.locator('header')).toContainText('星河音乐');
  await expect(page).toHaveTitle('站点设置 · 星河音乐');
  await expect(page.locator('meta[name=description]')).toHaveAttribute('content', '站点元数据');
  await expect(page.locator('link[rel=icon]')).toHaveAttribute('href', '/test-cover.svg');
  await expect(page.locator('footer a')).toHaveAttribute('href', 'https://example.test/about');
  await page.getByRole('link', { name: '首页', exact: true }).click();
  await expect(page.getByRole('heading', { name: homeTitle })).toBeVisible();
  await expect(page).toHaveTitle(`${homeTitle} · 星河音乐`);
  await expect(page.locator('meta[name=description]')).toHaveAttribute('content', '第一行介绍\n第二行介绍');
  await expect(page.locator('pre').first()).toContainText('https://api.example.test/api/open/v1/search');
  await page.reload();
  await expect(page.getByRole('heading', { name: homeTitle })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('custom-brand-home.png'), fullPage: true });
  await page.goto('/admin/settings');
  for (const label of ['首页描述', '站点描述', 'Logo 地址', '站点图标地址', '页脚文字', '页脚链接', 'API 独立域名']) {
    await page.getByLabel(label, { exact: true }).fill('');
  }
  await page.getByRole('checkbox', { name: '开放注册' }).uncheck();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
  await expect(page.locator('header img')).toHaveCount(0);
  await expect(page.locator('link[rel=icon]')).toHaveCount(0);
  await expect(page.locator('footer')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('pre').first()).toContainText('http://127.0.0.1:5175/api/open/v1/search');
  await expect(page.locator('meta[name=description]')).toHaveAttribute('content', '');
  await expect(page.getByRole('button', { name: '注册获取 API Key' })).toHaveCount(0);
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: '注册已关闭' })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  app.assertNoErrors();
});

test('未配置 API 来源时显示当前来源但不持久化占位值，保存失败保留草稿', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/settings');
  const origin = page.getByLabel('API 独立域名', { exact: true });
  await expect(origin).toHaveValue('');
  await expect(origin).toHaveAttribute('placeholder', 'http://127.0.0.1:5175');
  await page.getByLabel('系统标题', { exact: true }).fill('待保存品牌');
  await page.route('**/api/v1/admin/site/settings', async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({ status: 500, json: { error: { message: '保存失败测试' } } });
    else await route.fallback();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-sonner-toast]')).toContainText('保存失败测试');
  await expect(page.getByLabel('系统标题', { exact: true })).toHaveValue('待保存品牌');
  await expect(page.locator('header')).toContainText('Music Bank');
  await expect(page.getByText('已保存', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/admin/site/settings');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
  expect(app.requests.filter((r) => r.method === 'PUT').at(-1)?.body.apiOrigin).toBe('');
  app.assertNoErrors();
});

test('独立域名用于真实搜索、详情及签名媒体地址，管理请求仍同源', async ({ page }) => {
  const app = await mockApp(page);
  await page.route('**/api/v1/site', (route) =>
    route.fulfill({ json: { data: { ...defaultSiteSettings, apiOrigin: 'https://api.example.test' } } }),
  );
  const destinations: string[] = [];
  await page.route('https://api.example.test/api/open/v1/**', async (route) => {
    destinations.push(route.request().url());
    expect(route.request().headers()['x-api-key']).toBe('omb_test');
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      json: route.request().url().includes('/search?') ? { data: [track], total: 1 } : { data: track },
    });
  });
  await page.goto('/search');
  await page.getByLabel('API Key').fill('omb_test');
  await page.getByPlaceholder('输入歌名 / 别名，如 告白气球').fill('测试');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: /测试曲目.*测试艺术家/ }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', 'https://api.example.test/test-audio.wav');
  expect(destinations).toHaveLength(2);
  await page.goto('/admin/settings');
  await expect(page.getByLabel('系统标题', { exact: true })).toHaveValue('Music Bank');
  app.assertNoErrors();
});

test('公开配置加载失败可重试，不显示默认品牌或开放注册；文案不解释 HTML', async ({ page }) => {
  await mockApp(page, false);
  await page.route('**/api/v1/site', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '暂时不可用' } } }),
  );
  await page.goto('/');
  await expect(page.getByText('站点配置加载失败，请重试')).toBeVisible();
  await expect(page.locator('header')).toHaveCount(0);
  await page.unroute('**/api/v1/site');
  await page.route('**/api/v1/site', (route) =>
    route.fulfill({
      json: {
        data: {
          ...defaultSiteSettings,
          homeTitle: '<script>window.injected=true</script>',
          registrationEnabled: false,
        },
      },
    }),
  );
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '<script>window.injected=true</script>' })).toBeVisible();
  await expect(page.getByRole('button', { name: '注册', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'injected'))).toBeUndefined();
});
