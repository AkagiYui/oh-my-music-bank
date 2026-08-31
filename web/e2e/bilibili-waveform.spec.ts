import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { mockApp } from './fixtures';

async function openCropper(page: Page) {
  await page.goto('/music/import');
  await page.getByPlaceholder('或直接输入 BV 号（如 BV1xx411c7mD）').fill('BVwaveform');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.getByTestId('bili-timeline')).toBeVisible();
}

async function bufferRanges(page: Page, ranges: [number, number][]) {
  await page.locator('audio').evaluate((audio: HTMLAudioElement, next) => {
    audio.dataset.ranges = JSON.stringify(next);
    audio.dispatchEvent(new Event('progress'));
  }, ranges);
}

for (const width of [390, 1440]) {
  test(`${width}px AAC 波形按实际缓冲区补全，跳播留空且不干扰裁剪`, async ({ page }, testInfo) => {
    const app = await mockApp(page);
    await page.setViewportSize({ width, height: 1100 });
    await page.route('**/api/v1/admin/bilibili/resolve?**', (route) =>
      route.fulfill({
        json: {
          data: {
            aid: 1,
            bvid: 'BVwaveform',
            title: '分段音频波形测试',
            cover: '/test-cover.svg',
            owner: '测试 UP',
            pages: [
              { cid: 1, page: 1, part: '第一段', duration: 24 },
              { cid: 2, page: 2, part: '第二段', duration: 24 },
            ],
          },
        },
      }),
    );
    // 仅控制缓冲时间段以稳定重现稀疏加载；MP4 解封装和 AAC 解码均使用浏览器真实实现。
    await page.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
        get() {
          const ranges = JSON.parse(this.dataset.ranges ?? '[]') as [number, number][];
          return { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] };
        },
      });
    });
    const bytes = await readFile(new URL('./assets/waveform.m4a', import.meta.url));
    const reads: [number, number][] = [];
    await page.route('**/test-audio*.wav', async (route) => {
      const request = route.request();
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? '');
      const start = Number(match?.[1] ?? 0);
      const end = Math.min(bytes.length - 1, match?.[2] ? Number(match[2]) : bytes.length - 1);
      if (request.resourceType() === 'fetch') reads.push([start, end]);
      await route.fulfill({
        status: match ? 206 : 200,
        contentType: 'audio/mp4',
        headers: {
          'Accept-Ranges': 'bytes',
          ...(match ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
        },
        body: bytes.subarray(start, end + 1),
      });
    });
    await openCropper(page);
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration))
      .toBeCloseTo(24, 0);
    expect(reads).toHaveLength(0);
    const timeline = page.getByTestId('bili-timeline');
    const path = page.getByTestId('audio-waveform').locator('path');
    const initialBox = (await timeline.boundingBox())!;
    await bufferRanges(page, [[0, 3]]);
    await expect(path).not.toHaveAttribute('d', '');
    await expect(page.getByText('已加载部分显示波形，空白处尚未加载')).toBeVisible();
    const firstPath = (await path.getAttribute('d'))!;
    const bars = (d: string) =>
      [...d.matchAll(/M(\d+),([\d.]+)v([\d.]+)/g)].map((m) => ({ x: Number(m[1]), height: Number(m[3]) }));
    expect(bars(firstPath).every((b) => b.x < 202)).toBe(true);
    expect(bars(firstPath).some((b) => b.height > 20)).toBe(true);
    expect(
      bars(firstPath)
        .filter((b) => b.x < 50)
        .every((b) => b.height < 2),
    ).toBe(true);
    expect(reads.every(([start, end]) => end - start + 1 <= 128 * 1024)).toBe(true);
    expect(reads.reduce((sum, [start, end]) => sum + end - start + 1, 0)).toBeLessThan(bytes.length);

    await bufferRanges(page, [
      [0, 5],
      [18, 21],
    ]);
    await expect.poll(async () => bars((await path.getAttribute('d'))!).some((b) => b.x >= 1200)).toBe(true);
    const sparsePath = (await path.getAttribute('d'))!;
    expect(sparsePath.startsWith(firstPath)).toBe(true);
    expect(bars(sparsePath).some((b) => b.x > 400 && b.x < 1150)).toBe(false);
    const afterBox = (await timeline.boundingBox())!;
    expect(afterBox).toEqual(initialBox);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('waveform-sparse.png'), fullPage: true });

    await timeline.click({ position: { x: afterBox.width / 2, y: afterBox.height / 2 } });
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeCloseTo(12, 0);
    const start = page.getByRole('slider', { name: '裁剪起点' });
    await start.focus();
    await start.press('ArrowRight');
    await expect(start).toHaveAttribute('aria-valuenow', '0.5');
    const handle = (await start.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(afterBox.x + afterBox.width / 4, handle.y + handle.height / 2);
    await page.mouse.up();
    await expect.poll(async () => Number(await start.getAttribute('aria-valuenow'))).toBeCloseTo(6, 0);

    await bufferRanges(page, [[0, 24]]);
    await expect.poll(async () => bars((await path.getAttribute('d'))!).length).toBeGreaterThan(1590);
    await expect(page.getByText('已加载部分显示波形，空白处尚未加载')).toBeVisible();

    await page.getByRole('combobox', { name: '视频分 P' }).click();
    await page.getByRole('option', { name: 'P2 第二段 (0:24)' }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-2.wav');
    await expect(path).toHaveAttribute('d', '');
    await expect(start).toHaveAttribute('aria-valuenow', '0');
    app.assertNoErrors();
  });
}

test('不支持 Range 时停止波形读取，仍可试听和裁剪', async ({ page }) => {
  const app = await mockApp(page);
  await openCropper(page);
  await expect(page.getByText('波形暂不可用，仍可试听和裁剪')).toBeVisible();
  await page.getByRole('slider', { name: '裁剪起点' }).press('ArrowRight');
  await expect(page.getByRole('slider', { name: '裁剪起点' })).toHaveAttribute('aria-valuenow', '0.5');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  app.assertNoErrors();
});
