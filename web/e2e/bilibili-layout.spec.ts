import { expect, test } from '@playwright/test';
import { mockApp } from './fixtures';

// 长短标题、无空格英文和超长 UP 名都不能改变列宽或遮挡相邻视频。
const videos = [
  { title: '边玩边学 ESP32', upName: '测试 UP' },
  { title: '什么是 RTOS？'.repeat(20), upName: '很长的 UP 主名称'.repeat(12) },
  { title: 'ESP32_FreeRTOS_Development_Guide'.repeat(12), upName: 'Developer'.repeat(30) },
  { title: '算法设计与分析', upName: '课程分享' },
].map((video, index) => ({
  ...video,
  bvid: `BVlayout${index}`,
  cover: '/test-cover.svg',
  duration: 120,
  pages: 1,
}));

for (const width of [390, 768, 1440]) {
  test(`收藏夹视频在 ${width}px 下等宽、居中且不溢出`, async ({ page }, testInfo) => {
    const app = await mockApp(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/v1/admin/bilibili/favorites/1?**', (route) =>
      route.fulfill({ json: { data: { items: videos, hasMore: false } } }),
    );
    await page.goto('/music/import');
    await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
    await expect(page.getByRole('checkbox', { name: `选择 ${videos[0].title}`, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const bounds = [];
    for (const video of videos) {
      const button = page.getByRole('button', { name: `${video.title} ${video.upName} · 2:00`, exact: true });
      const checkbox = page.getByRole('checkbox', { name: `选择 ${video.title}`, exact: true });
      await expect(button).toBeVisible();
      const card = (await button.boundingBox())!;
      const check = (await checkbox.boundingBox())!;
      const row = (await button.locator('..').boundingBox())!;
      const cover = (await button.locator('img').boundingBox())!;
      // 检查真实几何尺寸，不能仅靠 overflow-hidden 把超宽卡片裁掉。
      expect(card.x).toBeGreaterThan(check.x + check.width);
      expect(Math.abs(card.x + card.width - (row.x + row.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(card.y + card.height / 2 - (check.y + check.height / 2))).toBeLessThanOrEqual(1);
      expect(cover.width).toBe(80);
      expect(cover.height).toBe(48);
      expect(card.x + card.width).toBeLessThanOrEqual(width);
      bounds.push(card);
    }
    for (const card of bounds) {
      expect(Math.abs(card.width - bounds[0].width)).toBeLessThanOrEqual(1);
      expect(card.height).toBe(bounds[0].height);
    }
    if (width >= 640) {
      expect(bounds[0].y).toBe(bounds[1].y);
      expect(bounds[0].x + bounds[0].width).toBeLessThan(bounds[1].x);
      expect(bounds[2].x).toBe(bounds[0].x);
    } else {
      expect(bounds[1].x).toBe(bounds[0].x);
      expect(bounds[1].y).toBeGreaterThan(bounds[0].y + bounds[0].height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    // 选择仍与打开视频独立，布局修复不改变原有交互。
    await page.getByRole('checkbox', { name: `选择 ${videos[0].title}`, exact: true }).check();
    expect(app.requests.some((request) => request.path.endsWith('/bilibili/resolve'))).toBe(false);
    await expect(page.getByRole('button', { name: '批量导入所选视频的全部分 P' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('favorites-layout.png'), fullPage: true });
    await page.getByRole('button', { name: `${videos[0].title} ${videos[0].upName} · 2:00`, exact: true }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-1.wav');
    app.assertNoErrors();
  });
}
