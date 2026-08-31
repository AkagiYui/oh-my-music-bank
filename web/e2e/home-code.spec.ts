import { expect, test } from '@playwright/test';
import { mockApp } from './fixtures';

test('首页两个代码框在浅色、深色及窄屏下保持高亮和原文', async ({ page }, testInfo) => {
  const app = await mockApp(page, false);
  await page.goto('/');
  const bash = page.locator('pre code.language-bash');
  const json = page.locator('pre code.language-json');
  await expect(bash).toBeVisible();
  await expect(json).toBeVisible();
  await expect(page.locator('pre')).toHaveCount(2);
  const command = await bash.textContent();
  expect(command).toContain('http://127.0.0.1:5175/api/open/v1/search?q=告白气球');
  expect(JSON.parse((await json.textContent())!)).toMatchObject({ total: 1, data: [{ duration: 215 }] });

  for (const dark of [false, true]) {
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark);
    // 检查实际计算颜色，防止只有 token 标记却没有加载高亮样式。
    for (const token of [bash.locator('.hljs-string').first(), json.locator('.hljs-attr').first()]) {
      const colors = await token.evaluate((element) => ({
        token: getComputedStyle(element).color,
        code: getComputedStyle(element.closest('code')!).color,
      }));
      expect(colors.token).not.toBe(colors.code);
    }
    await page.screenshot({ path: testInfo.outputPath(`home-code-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(bash).toHaveText(command!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  app.assertNoErrors();
});
