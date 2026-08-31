import { expect, test, type Page } from '@playwright/test';
import { mockApp } from './fixtures';
import type { BiliAccount } from '../src/lib/api';

const first: BiliAccount = {
  id: 'bili-1',
  mid: '9007199254740993',
  name: '主账号',
  avatar: '',
  isDefault: true,
  status: 'active',
  canRefresh: true,
  confirmPending: false,
  lastCheckedAt: null,
  lastRefreshedAt: null,
};
const second: BiliAccount = { ...first, id: 'bili-2', mid: '456', name: '备用账号', isDefault: false };

async function accountAPI(page: Page, initial: BiliAccount[] = [first, second]) {
  let accounts = structuredClone(initial);
  let generation = 0;
  let polls = 0;
  let status: 'waiting' | 'scanned' | 'expired' | 'success' = 'waiting';
  await page.route('**/api/v1/admin/bilibili/accounts', (route) => route.fulfill({ json: { data: accounts } }));
  await page.route('**/api/v1/admin/bilibili/accounts/*/default', (route) => {
    const id = route.request().url().split('/').at(-2);
    accounts = accounts.map((account) => ({ ...account, isDefault: account.id === id }));
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/admin/bilibili/accounts/*/refresh', (route) =>
    route.fulfill({ json: { data: { account: first, message: 'Cookie 已刷新并保存' } } }),
  );
  await page.route('**/api/v1/admin/bilibili/accounts/*', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    accounts = accounts.filter((account) => account.id !== route.request().url().split('/').at(-1));
    if (accounts.length && !accounts.some((a) => a.isDefault)) accounts[0].isDefault = true;
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/admin/bilibili/login', (route) => {
    generation++;
    return route.fulfill({
      json: {
        data: {
          id: `qr-${generation}`,
          url: `https://passport.bilibili.com/qr?key=${generation}`,
          expiresAt: new Date(Date.now() + 180_000).toISOString(),
          status: 'waiting',
        },
      },
    });
  });
  await page.route('**/api/v1/admin/bilibili/login/*/poll', (route) => {
    polls++;
    if (status === 'success' && !accounts.some((a) => a.id === first.id)) accounts.push({ ...first });
    return route.fulfill({
      json: {
        data: {
          id: `qr-${generation}`,
          status,
          expiresAt: new Date(Date.now() + 180_000).toISOString(),
          account: status === 'success' ? first : undefined,
        },
      },
    });
  });
  return {
    setStatus: (next: typeof status) => {
      status = next;
    },
    pollCount: () => polls,
  };
}

test('扫码状态、过期重试、登录去重及取消轮询', async ({ page }) => {
  const app = await mockApp(page);
  const state = await accountAPI(page, []);
  await page.goto('/admin/integrations');
  await expect(page.getByText('尚未登录账号，扫码添加后即可浏览收藏夹和导入音频。')).toBeVisible();
  await expect(page.getByPlaceholder('SESSDATA=xxx; bili_jct=xxx; ...')).toHaveCount(0);
  state.setStatus('expired');
  await page.getByRole('button', { name: '扫码添加账号' }).click();
  await expect(page.getByText('二维码已过期，请重新生成')).toBeVisible();
  state.setStatus('scanned');
  await page.getByRole('button', { name: '重新生成二维码' }).click();
  await expect(page.getByText('已扫码，请在手机上确认登录')).toBeVisible();
  state.setStatus('success');
  await expect(page.getByRole('region', { name: '主账号' })).toBeVisible({ timeout: 6000 });
  await expect(page.getByText('UID：9007199254740993')).toBeVisible();
  await page.getByRole('button', { name: '扫码添加账号' }).click();
  await expect(page.getByRole('region', { name: '扫码登录', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '扫码登录', exact: true })).toHaveCount(0, { timeout: 6000 });
  await expect(page.getByRole('region', { name: '主账号' })).toHaveCount(1);
  state.setStatus('waiting');
  await page.getByRole('button', { name: '扫码添加账号' }).click();
  await expect(page.getByRole('region', { name: '扫码登录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消登录' }).click();
  const count = state.pollCount();
  await page.clock.fastForward(10_000);
  expect(state.pollCount()).toBe(count);
  app.assertNoErrors();
});

test('账号检查刷新、默认切换和移除可在刷新页面后保留', async ({ page }) => {
  const app = await mockApp(page);
  await accountAPI(page);
  await page.goto('/admin/integrations');
  const main = page.getByRole('region', { name: '主账号' });
  const backup = page.getByRole('region', { name: '备用账号' });
  await main.getByRole('button', { name: '检查并刷新' }).click();
  await expect(page.getByText('Cookie 已刷新并保存')).toBeVisible();
  await backup.getByRole('button', { name: '设为默认' }).click();
  await expect(backup.getByText('默认', { exact: true })).toBeVisible();
  await page.reload();
  await expect(backup.getByText('默认', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await backup.getByRole('button', { name: '移除', exact: true }).click();
  await expect(backup).toHaveCount(0);
  await expect(main.getByText('默认', { exact: true })).toBeVisible();
  await page.reload();
  await expect(backup).toHaveCount(0);
  app.assertNoErrors();
});

test('切换导入账号清空旧选择，收藏夹、媒体与任务使用明确账号', async ({ page }) => {
  const app = await mockApp(page);
  await accountAPI(page);
  await page.goto('/music/import');
  const account = page.getByRole('combobox', { name: '导入账号' });
  await expect(account).toHaveText('主账号（默认）');
  await expect(account).toHaveAttribute('data-slot', 'select-trigger');
  await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
  await page.getByRole('button', { name: /测试视频.*测试 UP/ }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', '/test-audio-1.wav');
  await account.click();
  await expect(page.locator('[data-slot="select-content"]')).toBeVisible();
  await page.getByRole('option', { name: '备用账号', exact: true }).click();
  await expect(account).toHaveText('备用账号');
  await expect(account).toBeFocused();
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '选择 测试视频' })).toHaveCount(0);
  await expect
    .poll(() =>
      app.requests
        .filter((r) => r.path.endsWith('/bilibili/favorites'))
        .at(-1)
        ?.params.get('accountId'),
    )
    .toBe('bili-2');
  await page.getByRole('button', { name: '测试收藏夹 (2)' }).click();
  await expect
    .poll(() =>
      app.requests
        .filter((r) => r.path.endsWith('/favorites/1'))
        .at(-1)
        ?.params.get('accountId'),
    )
    .toBe('bili-2');
  await page.getByRole('button', { name: /测试视频.*测试 UP/ }).click();
  await expect
    .poll(() => app.requests.filter((r) => r.path.endsWith('/bilibili/media-token')).at(-1)?.body.accountId)
    .toBe('bili-2');
  await page.getByRole('button', { name: '加入此片段' }).click();
  await expect
    .poll(
      () =>
        (
          app.requests.filter((r) => r.path.endsWith('/jobs/bilibili')).at(-1)?.body.items as { accountId: string }[]
        )?.[0]?.accountId,
    )
    .toBe('bili-2');
  app.assertNoErrors();
});

test('旧账号提示补登录，失效账号不可选，手机宽度不横向溢出', async ({ page }) => {
  const app = await mockApp(page);
  await accountAPI(page, [
    { ...first, canRefresh: false },
    { ...second, status: 'expired' },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/integrations');
  await expect(page.getByText('旧账号缺少刷新凭据，请重新扫码启用自动刷新。')).toBeVisible();
  await expect(page.getByRole('region', { name: '备用账号' }).getByRole('button', { name: '设为默认' })).toBeDisabled();
  await page.getByRole('button', { name: '扫码添加账号' }).click();
  await expect(page.getByRole('region', { name: '扫码登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/music/import');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const account = page.getByRole('combobox', { name: '导入账号' });
  await expect(account).toHaveText('主账号（默认）');
  await account.click();
  await expect(page.getByRole('option', { name: '备用账号（登录失效）' })).toBeDisabled();
  const popup = page.locator('[data-slot="select-content"]');
  await expect(popup).toBeVisible();
  expect(await popup.evaluate((element) => getComputedStyle(element).getPropertyValue('--popover'))).toBe(
    await page.locator('html').evaluate((element) => getComputedStyle(element).getPropertyValue('--popover')),
  );
  const bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
  app.assertNoErrors();
});

test('账号弹层支持键盘切换，失效账号不能确认选择', async ({ page }) => {
  const app = await mockApp(page);
  await accountAPI(page, [first, { ...second, status: 'expired' }, { ...second, id: 'bili-3', name: '第三账号' }]);
  await page.goto('/music/import');
  const account = page.getByRole('combobox', { name: '导入账号' });
  await expect(account).toHaveText('主账号（默认）');
  await account.focus();
  await account.press('Enter');
  await expect(page.getByRole('option', { name: '主账号（默认）' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  // Base UI 允许聚焦禁用项以读取状态，但不能确认选择。
  const expired = page.getByRole('option', { name: '备用账号（登录失效）' });
  await expect(expired).toBeFocused();
  await expect(expired).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(account).toHaveText('主账号（默认）');
  await expect(expired).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '第三账号' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(account).toHaveText('第三账号');
  await expect(account).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect
    .poll(() =>
      app.requests
        .filter((r) => r.path.endsWith('/bilibili/favorites'))
        .at(-1)
        ?.params.get('accountId'),
    )
    .toBe('bili-3');
  app.assertNoErrors();
});

test('二维码生成与轮询失败可恢复，不遗留无限轮询', async ({ page }) => {
  const app = await mockApp(page);
  const state = await accountAPI(page, []);
  await page.route(
    '**/api/v1/admin/bilibili/login',
    (route) => route.fulfill({ status: 502, json: { message: '生成二维码失败' } }),
    { times: 1 },
  );
  await page.goto('/admin/integrations');
  await page.getByRole('button', { name: '扫码添加账号' }).click();
  await expect(page.getByRole('button', { name: '扫码添加账号' })).toBeEnabled();
  await page.route(
    '**/api/v1/admin/bilibili/login/*/poll',
    (route) => route.fulfill({ status: 502, json: { message: '轮询失败' } }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '扫码添加账号' }).click();
  await expect(page.getByText('暂时无法获取扫码状态，请重试')).toBeVisible();
  state.setStatus('success');
  await page.getByRole('button', { name: '重试查询' }).click();
  await expect(page.getByRole('region', { name: '主账号' })).toBeVisible();
  app.assertNoErrors();
});
