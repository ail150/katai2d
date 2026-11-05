import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('Verify output canvas mouse clicks and drags do not wipe results or cause subsequent errors', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open app
  await page.goto('http://127.0.0.1:5174/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // 2. Load benchmark study (Cantilever Sheet Pile)
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await page.getByRole('button', { name: /cantilever sheet pile/i }).first().click();
  await page.waitForTimeout(1000);

  // 3. Calculate
  await page.locator('button.run:has-text("Calculate")').click();
  await expect(page.locator('.statusbar')).toContainText(/completed/i, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Verify we are on Output tab and results are loaded
  await expect(page.locator('.viewtab.active')).toContainText(/Calculation Results/i);
  await expect(page.locator('[data-testid="result-legend"]')).toBeVisible();

  // 4. Perform extensive mouse interaction on the Output canvas (clicks, double clicks, drags)
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;

  // Single clicks at various locations (center, corners, near sheet pile)
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 50, cy - 30);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 60, cy + 40);
  await page.waitForTimeout(200);

  // Double click on canvas
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(300);

  // Left mouse drag (panning in Output view)
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cx - 40, cy - 30, { steps: 5 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);

  // Middle mouse drag
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 40, cy + 30, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(300);

  // Mouse wheel zoom
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(300);

  // Verify RESULTS ARE STILL VISIBLE AND NOT WIPED!
  await expect(page.locator('[data-testid="output-empty"]')).toHaveCount(0);
  await expect(page.locator('.result-summary')).toBeVisible();
  await expect(page.locator('.result-summary strong').first()).not.toBeEmpty();

  // 5. Test that subsequent Calculate STILL SUCCEEDS without errors
  await page.locator('button.run:has-text("Calculate")').click();
  await expect(page.locator('.statusbar')).toContainText(/completed/i, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Results still present
  await expect(page.locator('.result-summary')).toBeVisible();
  await expect(page.locator('[data-testid="output-empty"]')).toHaveCount(0);
});
