import { expect, test, type Page } from '@playwright/test';
import { mockApp, track } from './fixtures';

async function setupPlayer(page: Page) {
  const app = await mockApp(page);
  // 使用可被浏览器真实解码的长 WAV，跨页/裁剪互斥验证不依赖模拟 play()。
  await page.route('**/test-audio*.wav', async (route) => {
    const bytes = 8000 * 2 * 90;
    const audio = Buffer.alloc(44 + bytes);
    audio.write('RIFF', 0);
    audio.writeUInt32LE(audio.length - 8, 4);
    audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(8000, 24);
    audio.writeUInt32LE(16000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write('data', 36);
    audio.writeUInt32LE(bytes, 40);
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    const start = Number(range?.[1] ?? 0);
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: 'audio/wav',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}),
      },
      body: audio.subarray(start, end + 1),
    });
  });
  await page.route(`**/tracks/${track.id}`, (route) =>
    route.fulfill({
      json: {
        data: {
          ...track,
          audios: [
            track.audios![0],
            {
              ...track.audios![0],
              id: '22222222-2222-7222-8222-222222222222',
              qualityLabel: 'lossless',
              loudness: -8,
            },
          ],
        },
      },
    }),
  );
  return app;
}
async function startSearch(page: Page) {
  await page.goto('/search');
  await page.getByLabel('API Key').fill('omb_test');
  await page.getByPlaceholder('输入歌名 / 别名，如 告白气球').fill('测试');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: /测试曲目.*测试艺术家/ }).click();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: '播放 测试曲目', exact: true }).click();
  const dock = page.getByRole('region', { name: '全局播放器' });
  await expect(dock.locator('audio')).toHaveJSProperty('paused', false);
  await expect.poll(() => dock.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
  return dock;
}

for (const width of [1280, 390, 320]) {
  test(`${width}px 全局播放跨页持续、音质续播、裁剪双向互斥且不遮挡内容`, async ({ page }, testInfo) => {
    const app = await setupPlayer(page);
    await page.setViewportSize({ width, height: 844 });
    const dock = await startSearch(page);
    const initialAudio = await dock.locator('audio').elementHandle();
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page.getByText('第二页曲目')).toBeVisible();
    expect(await initialAudio!.evaluate((a: HTMLAudioElement) => a.isConnected && !a.paused)).toBe(true);
    await page.getByRole('link', { name: '首页', exact: true }).click();
    await expect(page.getByRole('heading', { name: '自定义音源系统' })).toBeVisible();
    expect(await initialAudio!.evaluate((a: HTMLAudioElement) => a.isConnected && !a.paused)).toBe(true);

    await dock.getByRole('button', { name: '暂停', exact: true }).click();
    const seek = dock.getByRole('slider', { name: '播放进度' });
    await seek.press('PageUp');
    const position = await dock.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime);
    expect(position).toBeGreaterThan(1);
    await dock.getByRole('button', { name: '播放', exact: true }).click();
    await dock.getByLabel('音质').selectOption('1');
    await expect(dock.locator('audio')).toHaveAttribute('src', 'http://127.0.0.1:5175/test-audio-hq.wav');
    await expect(dock.locator('audio')).toHaveJSProperty('paused', false);
    await expect
      .poll(() => dock.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThanOrEqual(position);
    await expect
      .poll(() => dock.locator('audio').evaluate((a: HTMLAudioElement) => a.volume))
      .toBeCloseTo(10 ** (-6 / 20));

    await page.getByRole('link', { name: '曲库管理', exact: true }).click();
    await page.getByRole('link', { name: '曲目', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停 测试曲目', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收起', exact: true }).click();
    await expect(page.locator('audio')).toHaveCount(1);
    await expect(dock.locator('audio')).toHaveJSProperty('paused', false);
    await page.getByRole('link', { name: '哔哩哔哩导入', exact: true }).click();
    await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
    await page.getByRole('button', { name: /测试视频.*测试 UP/ }).click();
    const cropAudio = page.locator('main audio');
    await expect(page.locator('audio')).toHaveCount(2);
    await page.getByRole('main').getByRole('button', { name: '播放', exact: true }).click();
    await expect(cropAudio).toHaveJSProperty('paused', false);
    await expect(dock.locator('audio')).toHaveJSProperty('paused', true);
    const pausedAt = await dock.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime);
    await dock.getByRole('button', { name: '播放', exact: true }).click();
    await expect(cropAudio).toHaveJSProperty('paused', true);
    await expect(dock.locator('audio')).toHaveJSProperty('paused', false);
    await page.getByRole('button', { name: '试听片段', exact: true }).click();
    await expect(cropAudio).toHaveJSProperty('paused', false);
    await expect(dock.locator('audio')).toHaveJSProperty('paused', true);
    expect(await dock.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(
      pausedAt,
    );

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const content = await page.getByRole('main').boundingBox();
    const bar = await dock.boundingBox();
    expect(content!.y + content!.height).toBeLessThanOrEqual(bar!.y + 1);
    expect(bar!.x).toBe(0);
    expect(bar!.width).toBe(width);
    expect(bar!.y + bar!.height).toBe(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath('global-player.png'), fullPage: true });
    await dock.locator('audio').dispatchEvent('error');
    const toast = page.locator('[data-sonner-toast][data-front="true"]');
    await expect(toast).toContainText('音频加载失败');
    await expect(toast).toHaveCSS('opacity', '1');
    const notice = await toast.boundingBox();
    expect(notice!.y + notice!.height).toBeLessThan(bar!.y);
    await toast.getByRole('button', { name: '关闭错误提示' }).click();
    await dock.getByRole('button', { name: '关闭播放器' }).click();
    await expect(dock).toHaveCount(0);
    await expect(page.locator('audio')).toHaveCount(1);
    await expect(cropAudio).toHaveJSProperty('paused', false);
    app.assertNoErrors();
  });
}

test('退出账号清理正在播放的全局会话', async ({ page }) => {
  const app = await setupPlayer(page);
  const dock = await startSearch(page);
  const audio = await dock.locator('audio').elementHandle();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(dock).toHaveCount(0);
  expect(await audio!.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  app.assertNoErrors();
});
