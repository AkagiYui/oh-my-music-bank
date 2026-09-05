import { expect, test } from '@playwright/test';
import { mockApp } from './fixtures';

for (const { width, dark } of [
  { width: 1280, dark: false },
  { width: 390, dark: true },
]) {
  test(`${width}px 音质弹层跟随主题，鼠标和键盘选择保留筛选语义`, async ({ page }, testInfo) => {
    const app = await mockApp(page, false);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/search');
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark);
    const quality = page.getByRole('combobox', { name: '音质筛选' });
    await expect(quality).toHaveText('全部音质');
    await expect(quality).toHaveAttribute('data-slot', 'select-trigger');
    expect(await quality.evaluate((element) => element.tagName)).toBe('BUTTON');
    await quality.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    const popup = page.locator('[data-slot="select-content"]');
    await expect(popup).toBeVisible();
    await expect(popup).toHaveCSS('border-radius', '0px');
    await expect(popup).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    // Portal 弹层必须继承主题 token；不依赖系统原生菜单的颜色。
    expect(await popup.evaluate((element) => getComputedStyle(element).getPropertyValue('--popover'))).toBe(
      await page.locator('html').evaluate((element) => getComputedStyle(element).getPropertyValue('--popover')),
    );
    const bounds = await popup.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('quality-select.png'), fullPage: true });
    await page.getByRole('option', { name: '无损', exact: true }).click();
    await expect(quality).toHaveText('无损');
    await expect(quality).toBeFocused();
    await page.getByLabel('API Key').fill('omb_test');
    await page.getByPlaceholder('专辑筛选').fill('测试专辑');
    await page.getByPlaceholder('语种筛选').fill('中文');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect
      .poll(() => app.requests.find((request) => request.path.endsWith('/search'))?.params.get('quality'))
      .toBe('lossless');

    await quality.focus();
    await quality.press('Enter');
    // Portal 的焦点交接异步完成，等选中项获得焦点后再发送后续键盘事件。
    await expect(page.getByRole('option', { name: '无损', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('option', { name: '全部音质', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(quality).toHaveText('全部音质');
    await expect(quality).toBeFocused();
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect.poll(() => app.requests.filter((request) => request.path.endsWith('/search')).length).toBe(2);
    const params = app.requests.filter((request) => request.path.endsWith('/search')).at(-1)!.params;
    expect(params.has('quality')).toBe(false);
    expect(params.get('album')).toBe('测试专辑');
    expect(params.get('language')).toBe('中文');

    await quality.click();
    await expect(page.getByRole('option', { name: '全部音质', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(quality).toHaveText('全部音质');
    await expect(quality).toBeFocused();
    app.assertNoErrors();
  });
}

test('角色选择提交原始角色值，刷新后显示服务端结果', async ({ page }) => {
  const app = await mockApp(page);
  let role = 'admin';
  const updates: unknown[] = [];
  await page.route('**/api/v1/admin/users**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      updates.push(body);
      role = body.role;
      await route.fulfill({ json: { data: {} } });
    } else {
      await route.fulfill({
        json: {
          data: [{ id: 'member-1', username: '测试用户', email: 'member@example.test', role, isActive: true }],
          total: 1,
          page: 1,
          pageSize: 50,
        },
      });
    }
  });
  await page.goto('/admin/users');
  const select = page.getByRole('combobox', { name: '测试用户 的角色' });
  await expect(select).toHaveText('admin');
  await select.click();
  await page.getByRole('option', { name: 'user', exact: true }).click();
  await expect.poll(() => updates).toEqual([{ role: 'user' }]);
  await expect(select).toHaveText('user');
  await page.reload();
  await expect(select).toHaveText('user');
  app.assertNoErrors();
});

test('分 P 保留数字 CID 和裁剪重置，识别服务的禁用项不能选中', async ({ page }, testInfo) => {
  const app = await mockApp(page);
  await page.goto('/music/import');
  await page.getByPlaceholder('或直接输入 BV 号（如 BV1xx411c7mD）').fill('BVtest');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  const parts = page.getByRole('combobox', { name: '视频分 P' });
  await expect(parts).toHaveText('P1 第一段 (2:00)');
  await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-1.wav');
  const start = page.getByRole('slider', { name: '裁剪起点' });
  await start.focus();
  await start.press('ArrowRight');
  await expect(start).toHaveAttribute('aria-valuenow', '0.5');
  await parts.click();
  await page.getByRole('option', { name: 'P2 第二段 (3:00)' }).click();
  await expect(parts).toHaveText('P2 第二段 (3:00)');
  await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-2.wav');
  await expect(start).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('slider', { name: '裁剪终点' })).toHaveAttribute('aria-valuenow', '180');

  const provider = page.getByRole('combobox', { name: '识别服务' });
  await expect(provider).toHaveText('讯飞');
  await provider.click();
  await expect(page.getByRole('option', { name: '网易云（需先拉取指纹资源）' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('provider-select.png'), fullPage: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(provider).toHaveText('讯飞');
  // 禁用项不会确认选择；退出弹层后再操作页面按钮。
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  // 识别窗口默认在裁剪范围内居中，讯飞取 58 秒上限。
  await expect(page.getByText('将识别 1:01 – 1:59 · 时长 0:58')).toBeVisible();
  await page.getByRole('button', { name: '识别此片段' }).click();
  await expect
    .poll(() => app.requests.find((request) => request.path.endsWith('/bilibili/recognize'))?.body)
    .toEqual({ accountId: 'bili-1', bvid: 'BVtest', cid: 2, startSec: 61, endSec: 119, provider: 'xfyun' });
  app.assertNoErrors();
});

test('网易云识别在浏览器内生成指纹后再提交匹配', async ({ page }) => {
  const app = await mockApp(page);
  // 指纹资源就绪后网易云才可选；覆盖默认的未拉取状态。
  await page.route('**/api/v1/admin/integrations', (route) =>
    route.fulfill({
      json: {
        data: {
          xfyunApiKeySet: true,
          xfyunAppId: 'test-app',
          neteaseAfp: {
            ready: true,
            source: 'fetched',
            verified: true,
            verifyHash: true,
            sourceUrl: '',
            version: '1.0.4',
            wasmSha256: 'wasm-sha',
            glueSha256: 'glue-sha',
            fetchedAt: '2026-09-06T00:00:00Z',
            extensionId: 'ext-id',
            expectedWasmSha: 'wasm-sha',
            expectedGlueSha: 'glue-sha',
          },
        },
      },
    }),
  );
  await page.goto('/music/import');
  await page.getByPlaceholder('或直接输入 BV 号（如 BV1xx411c7mD）').fill('BVtest');
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const provider = page.getByRole('combobox', { name: '识别服务' });
  await provider.click();
  await page.getByRole('option', { name: '网易云', exact: true }).click();
  await expect(provider).toHaveText('网易云');
  // 网易云窗口固定 6 秒，默认落在裁剪范围正中。
  await expect(page.getByText('将识别 0:57 – 1:03 · 时长 0:06')).toBeVisible();

  await page.getByRole('button', { name: '识别此片段' }).click();
  await expect
    .poll(() => app.requests.find((request) => request.path.endsWith('/bilibili/recognize/pcm'))?.body)
    .toEqual({ accountId: 'bili-1', bvid: 'BVtest', cid: 1, startSec: 57, durationSec: 6 });
  await expect
    .poll(() => {
      const body = app.requests.find((request) => request.path.endsWith('/bilibili/recognize'))?.body;
      if (!body) return undefined;
      return {
        provider: body.provider,
        startSec: body.startSec,
        endSec: body.endSec,
        rawdataLength: typeof body.rawdata === 'string' ? body.rawdata.length : 0,
      };
    })
    .toEqual({ provider: 'netease', startSec: 57, endSec: 63, rawdataLength: 12 });
  await expect(page.getByText('识别曲目')).toBeVisible();
  app.assertNoErrors();
});
