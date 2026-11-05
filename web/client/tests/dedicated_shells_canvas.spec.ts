import { test, expect } from '@playwright/test';

test('dedicated input and output canvas separation without cross-contamination', async ({ page }) => {
  test.setTimeout(90000);
  // Navigate to application
  await page.goto('http://127.0.0.1:5174/');

  // Auth if needed
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill('local-development-token');
    await page.getByRole('button', { name: 'Connect' }).click();
  }

  // 1. Verify that the redundant ribbon toolbar from the first screenshot has been removed
  const ribbon = page.locator('.ribbon');
  await expect(ribbon).toBeVisible();
  const ribbonTools = page.locator('.ribbon-tools:not(.compact)');
  await expect(ribbonTools).toHaveCount(0); // Fully removed!

  // 2. Verify CAD toolbar has Select and Pan
  const selectBtn = page.locator('.cad-tool-btn[title*="Select tool"]');
  const panBtn = page.locator('.cad-tool-btn[title*="Pan view"]');
  await expect(selectBtn).toBeVisible();
  await expect(panBtn).toBeVisible();

  // 3. Open presets modal and select Cantilever Sheet Pile with SSI
  await page.getByTitle('Browse all presets & studies').click();
  const modal = page.locator('.presetmodal');
  await expect(modal).toBeVisible();

  const studyCard = modal.locator('.preset-card').filter({
    hasText: 'Study: Cantilever sheet pile in clay (with Soil-Structure Interaction)'
  }).first();
  await studyCard.getByRole('button', { name: 'Load Preset' }).click();
  await expect(modal).not.toBeVisible();

  // Verify initial input state
  await expect(page.locator('.viewtab.active')).toHaveText('Model Geometry');
  await expect(page.locator('.result-legend')).not.toBeVisible();

  // Take screenshot of clean Input Canvas before run
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-input-canvas-clean.png' });

  // 4. Click Calculate
  const calcBtn = page.getByTitle('Calculate').first();
  await calcBtn.click();

  // Calculation switches to Output tab
  await expect(page.locator('.shellswitch button.on')).toHaveText(/Output/);
  await expect(page.locator('.viewtab.active')).toHaveText('Calculation Results');

  // Wait for solver completion
  const statusElem = page.locator('.result-summary .good, .result-summary .bad');
  await expect(statusElem).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.result-summary .good')).toHaveText('Converged');

  // In Output shell, verify result legend is visible
  await expect(page.locator('.result-legend')).toBeVisible();

  // Take screenshot of Output Canvas
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-output-canvas-dedicated.png' });

  // 5. Switch back to Input Shell
  await page.locator('.shellswitch button').filter({ hasText: 'Input' }).click();
  await expect(page.locator('.shellswitch button.on')).toHaveText(/Input/);
  await expect(page.locator('.viewtab.active')).toHaveText('Model Geometry');

  // In Input shell, verify result legend is NOT visible (no output leaking!)
  await expect(page.locator('.result-legend')).not.toBeVisible();
  await expect(page.locator('.struct-diagram-summary')).not.toBeVisible();

  // Verify CAD toolbar is back in Input shell
  await expect(selectBtn).toBeVisible();
  await expect(panBtn).toBeVisible();

  // Take screenshot of Input Canvas after run (must be pure input geometry, no contour colors!)
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-input-canvas-after-run.png' });

  // 6. Switch back to Output Shell
  await page.locator('.shellswitch button').filter({ hasText: 'Output' }).click();
  await expect(page.locator('.shellswitch button.on')).toHaveText(/Output/);
  await expect(page.locator('.viewtab.active')).toHaveText('Calculation Results');
  await expect(page.locator('.result-legend')).toBeVisible();
});
