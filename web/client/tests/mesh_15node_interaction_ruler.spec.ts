import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('verify 15-node mesh, soil-structure interaction, rulers, and coordinate badge', async ({ page }) => {
  test.setTimeout(180000);

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://127.0.0.1:5174/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // 1. Load copy study: "Study: Cantilever sheet pile in clay (with Soil-Structure Interaction)"
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  const studyButton = page.getByRole('button', { name: 'Study: Cantilever sheet pile in clay (with Soil-Structure Interaction)', exact: true });
  await expect(studyButton).toBeVisible();
  await studyButton.click();
  await page.waitForTimeout(1000);

  // Click Fit model
  await page.locator('button[title="Fit model"]').click();
  await page.waitForTimeout(500);

  // 2. Move mouse to trigger live coordinate tracking and ruler indicator
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.waitForTimeout(400);
  }

  // Verify coordinates badge is visible
  const coordBadge = page.locator('[data-testid="canvas-coords"]');
  await expect(coordBadge).toBeVisible();
  console.log('Coordinates badge text:', await coordBadge.textContent());

  // Take screenshot of Input with Soil-Structure Interaction and Rulers
  const screenshotInteractionPath = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-soil-structure-interaction-rulers.png';
  await page.screenshot({ path: screenshotInteractionPath });
  console.log('Saved interaction screenshot to:', screenshotInteractionPath);

  // 3. Click "Edit mesh settings" or switch to "Mesh" mode
  await page.getByRole('button', { name: 'Mesh', exact: true }).click();
  await page.waitForTimeout(500);

  // Verify "Edit Mesh Settings" is in the Properties sidebar
  const meshPanel = page.locator('[data-testid="mesh-settings-panel"]');
  await expect(meshPanel).toBeVisible();
  await expect(meshPanel.getByText('Edit Mesh Settings')).toBeVisible();

  // Verify only PLAXIS Auto-Mesher is present as generator (standard mesher removed)
  const genSelect = meshPanel.locator('select').first();
  const genText = await genSelect.textContent();
  expect(genText).toContain('PLAXIS Auto-Mesher');
  expect(genText).not.toContain('Standard Mesher');

  // 4. Select 15-Node (Tri15 Quartic) in Element Order select
  const orderSelect = meshPanel.locator('select').nth(2);
  await orderSelect.selectOption('15');
  await page.waitForTimeout(300);

  // Also select Coarse density to make 15-node fast
  const densitySelect = meshPanel.locator('select').nth(1);
  await densitySelect.selectOption('Coarse');
  await page.waitForTimeout(300);

  // 5. Click Generate Mesh in Properties panel
  await meshPanel.locator('button.mesh-gen-btn').click();

  // Wait for mesh notice
  await page.waitForFunction(() => {
    const el = document.querySelector('.statusbar') || document.querySelector('.messages');
    return el && el.textContent && el.textContent.includes('Tri15');
  }, { timeout: 35000 });

  await page.waitForTimeout(1000);

  // Verify Mesh Statistics card in Properties panel shows 15-Node Quartic (Tri15)
  const statsSummary = page.locator('[data-testid="mesh-stats-summary"]');
  await expect(statsSummary).toBeVisible();
  const statsText = await statsSummary.textContent();
  console.log('Stats text:', statsText);
  expect(statsText).toContain('15-Node Quartic (Tri15)');

  // Take screenshot of 15-node mesh and Properties mesh panel
  const screenshotMesh15Path = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-15node-mesh-settings.png';
  await page.screenshot({ path: screenshotMesh15Path });
  console.log('Saved 15-node mesh screenshot to:', screenshotMesh15Path);

  // 6. Click Calculate and verify calculation runs on the explicit PLAXIS mesh
  await page.getByRole('button', { name: 'Calculate' }).click();
  await page.waitForTimeout(1000);

  // Wait for calculation completion
  await page.waitForFunction(() => {
    const statusbar = document.querySelector('.statusbar');
    return statusbar && (statusbar.textContent?.includes('Results loaded') || statusbar.textContent?.includes('Calculation completed'));
  }, { timeout: 120000 });

  await page.waitForTimeout(2000);

  // Take screenshot of Calculation Results on the 15-node mesh
  const screenshotOutputPath = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-15node-calculation-output.png';
  await page.screenshot({ path: screenshotOutputPath });
  console.log('Saved calculation output screenshot to:', screenshotOutputPath);
});
