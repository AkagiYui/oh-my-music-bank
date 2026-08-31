import { expect, test, type Page } from '@playwright/test';
import { mockApp, track } from './fixtures';

async function layout(page: Page) {
  // 测量正文及交互控件的实际位置和尺寸，捕获整体位移、卡片撑高及横向溢出。
  return page.evaluate(() => ({
    elements: [...document.querySelectorAll('main, main input, main button, main audio')].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
}

for (const width of [1280, 390]) {
  for (const action of ['login', 'register']) {
    test(`${width}px ${action} 错误出现、变长、关闭和重试均不挤动表单`, async ({ page }) => {
      const app = await mockApp(page, false);
      await page.setViewportSize({ width, height: 844 });
      let message = '邮箱或密码不正确，请检查后重试';
      await page.route(`**/api/v1/auth/${action}`, (route) =>
        route.fulfill({ status: 400, json: { error: { code: 'invalid_input', message } } }),
      );
      await page.goto(`/${action}`);
      await expect(page.getByRole('link', { name: 'Music Bank', exact: true })).toBeVisible();
      if (action === 'register') await page.getByLabel('用户名').fill('tester');
      await page.getByLabel('邮箱').fill('test@example.test');
      await page.getByLabel('密码').fill('test-password');
      const password = page.getByLabel('密码');
      const before = await layout(page);

      for (const detail of [message, `服务暂不可用：${'详细错误'.repeat(200)} ${'a'.repeat(500)}`]) {
        message = detail;
        await password.press('Enter');
        const alert = page.locator('[data-sonner-toast][data-front="true"] [data-description]');
        // Sonner 在退出动画期间保留旧节点；动画结束后仍只能存在一个错误提示。
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
        await expect(alert).toHaveText(detail);
        expect(await layout(page)).toEqual(before);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        // 从输入框提交，避开按钮禁用时浏览器自动失焦，确认浮层本身不抢焦点。
        await expect(password).toBeFocused();
        await expect(
          page.locator('[data-sonner-toast][data-front="true"]').getByRole('button', { name: '关闭错误提示' }),
        ).toBeInViewport();
        if (detail.length > 100) {
          const text = alert.locator('p');
          expect(await text.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
          await text.focus();
          await text.press('End');
          await expect.poll(() => text.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        }
        await page
          .locator('[data-sonner-toast][data-front="true"]')
          .getByRole('button', { name: '关闭错误提示' })
          .click();
        await expect(alert).toHaveCount(0);
        expect(await layout(page)).toEqual(before);
      }
      app.assertNoErrors();
    });
  }
}

test('创建 API Key 失败只显示一次浮层，控制台布局不变', async ({ page }) => {
  const app = await mockApp(page);
  await page.route('**/api/v1/api-keys', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: '创建失败，请稍后重试' } } }),
  );
  await page.goto('/dashboard');
  await expect(page.getByText('测试 Key', { exact: true })).toBeVisible();
  const before = await layout(page);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toHaveText(
    '创建失败，请稍后重试',
  );
  await expect(page.getByText('创建失败，请稍后重试', { exact: true })).toHaveCount(1);
  expect(await layout(page)).toEqual(before);
  app.assertNoErrors();
});

test('搜索和音频错误不推移控件，搜索失败保留已有结果及详情', async ({ page }) => {
  const app = await mockApp(page, false);
  await page.goto('/search');
  await expect(page.getByRole('link', { name: 'Music Bank', exact: true })).toBeVisible();
  const submit = page.getByRole('button', { name: '搜索', exact: true });
  const before = await layout(page);
  await submit.click();
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toContainText(
    '请先填写 API Key',
  );
  expect(await layout(page)).toEqual(before);

  await page.getByLabel('API Key').fill('omb_test');
  await page.getByPlaceholder('输入歌名 / 别名，如 告白气球').fill('测试');
  await submit.click();
  await page.getByRole('button', { name: /测试曲目.*测试艺术家/ }).click();
  const audio = page.locator('audio');
  await expect(audio).toHaveAttribute('src', 'http://127.0.0.1:5175/test-audio.wav');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThan(0);
  const withResults = await layout(page);
  await audio.dispatchEvent('error');
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toContainText('音频加载失败');
  expect(await layout(page)).toEqual(withResults);
  await page.locator('[data-sonner-toast][data-front="true"]').getByRole('button', { name: '关闭错误提示' }).click();

  await page.route(`**/api/open/v1/tracks/${track.id}`, (route) =>
    route.fulfill({ status: 503, json: { error: { message: '详情加载失败' } } }),
  );
  await page.getByRole('button', { name: /测试曲目.*测试艺术家/ }).click();
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toHaveText('详情加载失败');
  expect(await layout(page)).toEqual(withResults);

  await page.route('**/api/open/v1/search?**', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '搜索服务暂不可用' } } }),
  );
  await submit.click();
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toContainText(
    '搜索服务暂不可用',
  );
  expect(await layout(page)).toEqual(withResults);
  await expect(audio).toHaveAttribute('src', 'http://127.0.0.1:5175/test-audio.wav');
  app.assertNoErrors();
});

test('导入裁剪和集成测试失败使用浮层并保留页面内容', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/music/import');
  await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
  const video = page.getByRole('button', { name: /测试视频.*测试 UP/ });
  await video.click();
  const audio = page.locator('audio');
  await expect(audio).toHaveAttribute('src', '/test-audio-1.wav');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThan(0);
  const before = await layout(page);
  await audio.dispatchEvent('error');
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toContainText('音频加载失败');
  expect(await layout(page)).toEqual(before);
  await page.route('**/api/v1/admin/bilibili/resolve?**', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '视频加载失败' } } }),
  );
  await video.click();
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toHaveText('视频加载失败');
  expect(await layout(page)).toEqual(before);

  await page.goto('/admin/integrations');
  await expect(page.getByRole('button', { name: '测试 B 站连接' })).toBeVisible();
  await page.route('**/api/v1/admin/integrations/test', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '连接测试失败' } } }),
  );
  const integrations = await layout(page);
  await page.getByRole('button', { name: '测试 B 站连接' }).click();
  await expect(page.locator('[data-sonner-toast][data-front="true"] [data-description]')).toHaveText('连接测试失败');
  await expect(page.getByText('连接测试失败', { exact: true })).toHaveCount(1);
  expect(await layout(page)).toEqual(integrations);
  app.assertNoErrors();
});
