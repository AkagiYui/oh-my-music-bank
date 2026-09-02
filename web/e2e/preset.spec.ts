import { expect, test, type Page } from '@playwright/test';
import { mockApp } from './fixtures';

async function expectLyraSurfaces(page: Page) {
  // 检查最终计算样式，捕获调用方覆盖、第三方 CSS 和伪元素的圆角；官方 Avatar 是圆形例外。
  await expect
    .poll(async () =>
      page.evaluate(() =>
        [...document.querySelectorAll('body *')].flatMap((element) => {
          if (!(element instanceof HTMLElement) || element.closest('[data-slot="avatar"]')) return [];
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height || !element.checkVisibility()) return [];
          return [null, '::before', '::after'].flatMap((pseudo) => {
            const style = getComputedStyle(element, pseudo);
            if (pseudo && (style.content === 'none' || style.content === 'normal')) return [];
            const corners = [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomLeftRadius,
              style.borderBottomRightRadius,
            ];
            if (corners.every((corner) => corner === '0px')) return [];
            return [{ tag: element.tagName, className: element.className, pseudo, corners }];
          });
        }),
      ),
    )
    .toEqual([]);
}

for (const width of [1280, 390]) {
  test(`${width}px 全部页面的实际形状符合 Lyra，头像保留圆形`, async ({ page }) => {
    test.setTimeout(60_000);
    const app = await mockApp(page);
    await page.setViewportSize({ width, height: 844 });
    for (const [path, text] of [
      ['/', '自定义音源系统'],
      ['/search', '搜索音乐'],
      ['/dashboard', '账号设置'],
      ['/admin', '概览'],
      ['/music', '概览'],
      ['/music/upload', '批量上传音频'],
      ['/music/jobs', '收录任务'],
      ['/music/import', '从哔哩哔哩导入'],
      ['/music/tracks', '曲目管理'],
      ['/music/artists', '艺术家管理'],
      ['/music/albums', '专辑管理'],
      ['/admin/api-keys', 'API Key 管理'],
      ['/admin/logs', '调用日志'],
      ['/admin/users', '用户管理'],
      ['/admin/settings', '站点设置'],
      ['/admin/integrations', '集成配置'],
      ['/login', '邮箱'],
      ['/register', '用户名'],
      ['/missing-page', '页面不存在（404）'],
    ]) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
        // 等待首屏数据和本地字体，确保列表、标签等异步内容也参与审查。
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        await expectLyraSurfaces(page);
      });
    }
    app.assertNoErrors();
  });

  test(`${width}px 编辑区、播放器、裁剪器及通知不再遗漏预设形状`, async ({ page }, testInfo) => {
    const app = await mockApp(page);
    await page.setViewportSize({ width, height: 844 });

    await page.goto('/music/artists');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: '艺名' })).toBeVisible();
    await expect(page.locator('[data-slot="avatar-fallback"]')).toBeVisible();
    expect(
      await page.locator('[data-slot="avatar"]').evaluate((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width === height && parseFloat(getComputedStyle(element).borderTopLeftRadius) >= width / 2;
      }),
    ).toBe(true);
    await expectLyraSurfaces(page);
    await page.screenshot({ path: testInfo.outputPath('artist-editor.png'), fullPage: true });

    await page.goto('/music/albums');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByLabel('碟号')).toHaveValue('1');
    await expectLyraSurfaces(page);

    await page.goto('/music/tracks');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('button', { name: '播放 测试曲目', exact: true }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', 'http://127.0.0.1:5175/test-audio.wav');
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'standard' })).toBeVisible();
    await expectLyraSurfaces(page);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText('omb_created_once', { exact: true })).toBeVisible();
    await expectLyraSurfaces(page);

    await page.goto('/music/import');
    const folder = page.getByRole('button', { name: '测试收藏夹 (2)' });
    await folder.click();
    await expect(folder).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /测试视频.*测试 UP/ }).click();
    await expect(page.getByRole('slider', { name: '裁剪起点' })).toBeVisible();
    const audio = page.locator('audio');
    await expect(audio).toHaveAttribute('src', '/test-audio-1.wav');
    await expectLyraSurfaces(page);
    await audio.dispatchEvent('error');
    const toast = page.locator('[data-sonner-toast][data-front="true"]');
    await expect(toast).toContainText('音频加载失败');
    await expect(toast.getByRole('button', { name: '关闭错误提示' })).toBeVisible();
    await expectLyraSurfaces(page);
    await expect(toast).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('import-error.png'), fullPage: true });
    app.assertNoErrors();
  });
}
