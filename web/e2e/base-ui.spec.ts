import { expect, test } from '@playwright/test';
import { mockApp } from './fixtures';

test('账号设置按钮迁移后仍能提交邮箱和密码', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/dashboard');
  await page.getByPlaceholder('admin@example.test').fill('updated@example.test');
  await page.getByRole('button', { name: '修改邮箱', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('邮箱已更新');
  expect(app.requests).toContainEqual(
    expect.objectContaining({
      path: '/api/v1/profile/email',
      method: 'PUT',
      body: { email: 'updated@example.test' },
    }),
  );
  await page.getByPlaceholder('当前密码').fill('current-password');
  await page.getByPlaceholder('新密码（修改后所有会话退出）').fill('updated-password');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(app.requests).toContainEqual(
    expect.objectContaining({
      path: '/api/v1/profile/password',
      method: 'PUT',
      body: { currentPassword: 'current-password', newPassword: 'updated-password' },
    }),
  );
  app.assertNoErrors();
});

test('复选框支持标签点击和 Space，并保存布尔值且保持尺寸', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/settings');
  await expect(page.getByLabel('站点名称')).toHaveValue('Music Bank');
  const checkbox = page.getByRole('checkbox', { name: '开放注册' });
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveCSS('width', '16px');
  await expect(checkbox).toHaveCSS('height', '16px');
  const before = await checkbox.boundingBox();
  await page.getByText('开放注册', { exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  expect(await checkbox.boundingBox()).toEqual(before);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  expect(app.requests).toContainEqual(
    expect.objectContaining({
      path: '/api/v1/admin/site/settings',
      method: 'PUT',
      body: expect.objectContaining({ registrationEnabled: false }),
    }),
  );
  app.assertNoErrors();
});

test('任务进度的视觉填充与无障碍数值一致', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/admin/jobs');
  const progress = page.getByRole('progressbar', { name: '收录进度' });
  await expect(progress).toHaveAttribute('aria-valuenow', '30');
  await expect(progress).toHaveAttribute('aria-valuemax', '100');
  const track = progress.locator('[data-slot="progress-track"]');
  const indicator = progress.locator('[data-slot="progress-indicator"]');
  // 等待宽度过渡结束，再校验实际布局，避免仅检查内联样式遗漏视觉回归。
  await expect
    .poll(async () => {
      const total = await track.boundingBox();
      const filled = await indicator.boundingBox();
      return Math.round((filled!.width / total!.width) * 100);
    })
    .toBe(30);
  app.assertNoErrors();
});
