import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('verify automatic phase inheritance and safety calculation for cantilever sheet pile', async ({ page }) => {
  test.setTimeout(300000);

  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]:', err.message, err.stack);
  });

  await page.goto('http://127.0.0.1:5174/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // Open Studies menu and load "Study: Cantilever sheet pile in clay"
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await page.getByRole('button', { name: 'Study: Cantilever sheet pile in clay', exact: true }).click();
  await page.waitForTimeout(1000);

  // Switch to Staged Construction mode
  await page.click('button:has-text("Staged Construction")');
  await page.waitForTimeout(1000);

  // Click "+" button next to "Calculation phases" to add Phase 2
  console.log('Adding phase...');
  const addPhaseBtn = page.locator('.treefolder:has-text("Calculation phases") button').first();
  await addPhaseBtn.click();
  await page.waitForTimeout(1000);

  // Set Type to "Safety (Phi-c reduction)"
  console.log('Selecting Safety calculation type...');
  const typeSelect = page.locator('.stage-inspector select').first();
  await typeSelect.selectOption('1'); // 1 is Safety (Phi-c reduction)
  await page.waitForTimeout(1000);

  // Verify that checkboxes automatically inherited the active state from Phase 1:
  // Excavation cut should be UNCHECKED (inherited 0)
  const excCutCheckbox = page.locator('.stage-inspector label.checkfield:has-text("Excavation cut") input[type="checkbox"]');
  await expect(excCutCheckbox).toBeVisible();
  expect(await excCutCheckbox.isChecked()).toBe(false);

  // Sheet pile wall should be CHECKED (inherited 1)
  const wallCheckbox = page.locator('.stage-inspector label.checkfield:has-text("Sheet pile wall") input[type="checkbox"]');
  await expect(wallCheckbox).toBeVisible();
  expect(await wallCheckbox.isChecked()).toBe(true);

  // Take screenshot of Stage Construction configuration
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-cantilever-safety-config.png' });

  // Click Calculate
  console.log('Clicking Calculate...');
  await page.click('button.run:has-text("Calculate")');

  // Monitor progress
  const start = Date.now();
  let completed = false;
  let hasFailed = false;
  while (Date.now() - start < 240000) {
    await page.waitForTimeout(3000);
    const statusText = await page.locator('.statusbar').innerText().catch(() => '');
    const msgText = await page.locator('.messages').innerText().catch(() => '');
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] Status: "${statusText.replace(/\n/g, ' ')}" | Msg: "${msgText.slice(0, 100).replace(/\n/g, ' ')}"`);

    if (msgText.includes('exited with code') || msgText.includes('failed') || msgText.includes('cancelled')) {
      console.log('Calculation failed/cancelled:', { statusText, msgText });
      hasFailed = true;
      break;
    }
    if (msgText.includes('Calculation completed') || statusText.includes('Results loaded')) {
      console.log('Calculation completed successfully!');
      completed = true;
      break;
    }
  }

  expect(hasFailed).toBe(false);
  expect(completed).toBe(true);

  // Wait 2 seconds for results to fully render in Output tab
  await page.waitForTimeout(2000);

  // Switch to Output tab if not already there
  const outputBtn = page.getByRole('button', { name: 'Output', exact: true });
  await outputBtn.click();
  await page.waitForTimeout(1500);

  // Select Phase 2 (Safety phase) in Output explorer if not selected
  const phaseSelect = page.locator('.output-explorer select').first();
  if (await phaseSelect.count() > 0) {
    await phaseSelect.selectOption('2');
  }
  await page.waitForTimeout(1500);

  // Verify Factor of safety text in the properties panel
  const propertiesText = await page.locator('.properties').innerText();
  console.log('Properties text:', propertiesText);
  expect(propertiesText).toContain('Factor of safety');
  expect(propertiesText).toContain('1.541');
  expect(propertiesText).toContain('No structural forces reported for Safety phase');

  // Take screenshot of Output view
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-cantilever-safety-output.png' });
});
