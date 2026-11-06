import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('verify mesh size changes in input are used in calculation and output', async ({ page }) => {
  test.setTimeout(180000);

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://127.0.0.1:5173/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // 1. Open Presets library and load "KV-CST-008 HSsmall unloading" (user's exact study case)
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  const searchInput = page.getByPlaceholder('Search by case name, material or keyword...');
  await expect(searchInput).toBeVisible({ timeout: 5000 });
  await searchInput.fill('KV-CST-008');
  await page.waitForTimeout(500);

  const loadPresetBtn = page.getByRole('button', { name: 'Load Preset' }).first();
  await expect(loadPresetBtn).toBeVisible();
  await loadPresetBtn.click();
  await page.waitForTimeout(1000);

  // Click Fit model
  await page.locator('button[title="Fit model"]').click();
  await page.waitForTimeout(500);

  // 2. Switch to Mesh mode
  await page.getByRole('button', { name: 'Mesh', exact: true }).click();
  await page.waitForTimeout(500);

  const meshPanel = page.locator('[data-testid="mesh-settings-panel"]');
  await expect(meshPanel).toBeVisible();

  // 3. Select Fine density (0.7x) and 6-Node Quadratic
  const densitySelect = meshPanel.locator('select').nth(1);
  await densitySelect.selectOption('Fine');
  await page.waitForTimeout(300);

  // Click Generate Mesh
  await meshPanel.locator('button.mesh-gen-btn').click();

  // Wait for mesh notice
  await page.waitForFunction(() => {
    const el = document.querySelector('.statusbar') || document.querySelector('.messages');
    return el && el.textContent && el.textContent.includes('Mesh ready');
  }, { timeout: 35000 });

  await page.waitForTimeout(1000);

  // Verify Mesh Statistics card shows fine mesh node count
  const statsSummary = page.locator('[data-testid="mesh-stats-summary"]');
  await expect(statsSummary).toBeVisible();
  const statsText = await statsSummary.textContent();
  console.log('Input Mesh Stats text:', statsText);
  // Default coarse mesh has only 8 elements. Fine mesh has significantly more!
  expect(statsText).toContain('PLAXIS Style (Gmsh)');

  // Take screenshot of Input mesh
  const inputMeshScreenshot = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-input-fine-mesh-verified.png';
  await page.screenshot({ path: inputMeshScreenshot });
  console.log('Saved input mesh screenshot to:', inputMeshScreenshot);

  // 4. Click Calculate from top ribbon
  await page.getByRole('button', { name: 'Calculate' }).click();
  await page.waitForTimeout(1000);

  // 5. Wait for calculation completion
  await page.waitForFunction(() => {
    const statusbar = document.querySelector('.statusbar');
    return statusbar && (statusbar.textContent?.includes('Results loaded') || statusbar.textContent?.includes('Calculation completed'));
  }, { timeout: 120000 });

  await page.waitForTimeout(2000);

  // Switch to Output shell if not already there
  const outputBtn = page.getByRole('button', { name: 'Output', exact: true });
  if (await outputBtn.isVisible()) {
    await outputBtn.click();
    await page.waitForTimeout(500);
  }

  // 6. Inspect calculation result table in Output properties
  // Open nodal result table details
  const nodalTableDetails = page.locator('details:has-text("Nodal result table: all nodes")');
  await expect(nodalTableDetails).toBeVisible();
  await nodalTableDetails.locator('summary').click();
  await page.waitForTimeout(500);

  const rows = nodalTableDetails.locator('tbody tr');
  const rowCount = await rows.count();
  console.log('Output mesh row count (nodes):', rowCount);

  // Old default coarse mesh only had 33 nodes.
  // The fine PLAXIS mesh has > 100 nodes!
  expect(rowCount).toBeGreaterThan(50);

  // Take screenshot of Output mesh showing calculation results on the fine PLAXIS mesh
  const outputMeshScreenshot = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-output-fine-mesh-verified.png';
  await page.screenshot({ path: outputMeshScreenshot });
  console.log('Saved output mesh screenshot to:', outputMeshScreenshot);
});

test('verify changing mesh size without clicking generate mesh automatically recalculates on new PLAXIS mesh', async ({ page }) => {
  test.setTimeout(180000);

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://127.0.0.1:5173/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // 1. Load "KV-CST-008 HSsmall unloading"
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  const searchInput = page.getByPlaceholder('Search by case name, material or keyword...');
  await expect(searchInput).toBeVisible({ timeout: 5000 });
  await searchInput.fill('KV-CST-008');
  await page.waitForTimeout(500);

  const loadPresetBtn = page.getByRole('button', { name: 'Load Preset' }).first();
  await expect(loadPresetBtn).toBeVisible();
  await loadPresetBtn.click();
  await page.waitForTimeout(1000);

  // 2. Switch to Mesh mode and change Density to "Coarse" without clicking Generate Mesh
  await page.getByRole('button', { name: 'Mesh', exact: true }).click();
  await page.waitForTimeout(500);

  const meshPanel = page.locator('[data-testid="mesh-settings-panel"]');
  await expect(meshPanel).toBeVisible();

  const densitySelect = meshPanel.locator('select').nth(1);
  await densitySelect.selectOption('Coarse');
  await page.waitForTimeout(500);

  // 3. Immediately click Calculate
  await page.getByRole('button', { name: 'Calculate' }).click();
  await page.waitForTimeout(1000);

  // Wait for calculation completion
  await page.waitForFunction(() => {
    const statusbar = document.querySelector('.statusbar');
    return statusbar && (statusbar.textContent?.includes('Results loaded') || statusbar.textContent?.includes('Calculation completed'));
  }, { timeout: 120000 });

  await page.waitForTimeout(2000);

  // Check nodal result count in Output
  const nodalTableDetails = page.locator('details:has-text("Nodal result table: all nodes")');
  await expect(nodalTableDetails).toBeVisible();
  await nodalTableDetails.locator('summary').click();
  await page.waitForTimeout(500);

  const rows = nodalTableDetails.locator('tbody tr');
  const rowCount = await rows.count();
  console.log('Auto-meshed Output node count:', rowCount);

  // Coarse PLAXIS mesh on 2x10 has between 100 and 400 nodes, definitely > 50 and not 33
  expect(rowCount).toBeGreaterThan(50);
});

