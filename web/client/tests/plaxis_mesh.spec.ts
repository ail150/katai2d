import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('verify PLAXIS style auto-mesher UI and mesh generation', async ({ page }) => {
  test.setTimeout(60000);

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://127.0.0.1:5174/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // Load "Study: Cantilever sheet pile in clay"
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await page.getByRole('button', { name: 'Study: Cantilever sheet pile in clay', exact: true }).click();
  await page.waitForTimeout(1000);

  // Switch to Mesh mode
  await page.getByRole('button', { name: 'Mesh', exact: true }).click();
  await page.waitForTimeout(1000);

  // Click Fit model
  await page.locator('button[title="Fit model"]').click();
  await page.waitForTimeout(500);

  // Click Generate Mesh
  await page.click('button.run:has-text("Generate Mesh")');

  // Wait for mesh notice
  await page.waitForFunction(() => {
    const el = document.querySelector('.statusbar') || document.querySelector('.messages');
    return el && el.textContent && el.textContent.includes('PLAXIS Style');
  }, { timeout: 30000 });

  await page.waitForTimeout(1500);

  const screenshotPath = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/plaxis_mesh_cantilever_ui.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Saved screenshot to:', screenshotPath);
});
