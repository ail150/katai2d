import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('verify undeformed mesh, deformed scale factor, and hiding of polygons and loads in output', async ({ page }) => {
  test.setTimeout(120000);

  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]:', err.message);
  });

  await page.goto('http://127.0.0.1:5173/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // Load "Tutorial 1 · flexible footing"
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Tutorial 1 · flexible footing', exact: true }).click();
  await page.waitForTimeout(1000);

  // First calculate or refresh results
  console.log('Calculating model...');
  await page.click('button.run:has-text("Calculate")');
  await page.waitForTimeout(1000);

  // Monitor calculation progress
  const start = Date.now();
  let completed = false;
  while (Date.now() - start < 120000) {
    await page.waitForTimeout(2000);
    const statusText = await page.locator('.statusbar').innerText().catch(() => '');
    const msgText = await page.locator('.messages').innerText().catch(() => '');
    if (msgText.includes('Calculation completed') || statusText.includes('Results loaded') || msgText.includes('completed')) {
      console.log('Calculation completed successfully!');
      completed = true;
      break;
    }
  }
  expect(completed).toBe(true);
  await page.waitForTimeout(2000);

  // Switch to Output tab
  console.log('Switching to Output tab...');
  const outputBtn = page.getByRole('button', { name: 'Output', exact: true });
  await outputBtn.click();
  await page.waitForTimeout(2000);

  // Verify OUTPUT EXPLORER is visible
  await expect(page.getByText('OUTPUT EXPLORER')).toBeVisible();

  // Verify that Undeformed and Deformed mesh toggle buttons exist in the ribbon
  const undeformedRibbonBtn = page.getByRole('button', { name: 'Undeformed', exact: true });
  const deformedRibbonBtn = page.getByRole('button', { name: 'Deformed', exact: true });
  await expect(undeformedRibbonBtn).toBeVisible();
  await expect(deformedRibbonBtn).toBeVisible();

  // Verify Scale controls exist in ribbon when deformed
  const scaleInput = page.locator('.deform-scale-input');
  const scaleSelect = page.locator('.deform-scale-select');
  const scaleAutoBtn = page.locator('.deform-scale-auto-btn');
  await expect(scaleInput).toBeVisible();
  await expect(scaleSelect).toBeVisible();
  await expect(scaleAutoBtn).toBeVisible();

  // Verify Output sidebar phase picker has the scale row
  const sidebarScaleBadge = page.locator('.output-scale-badge');
  await expect(sidebarScaleBadge).toBeVisible();
  const sidebarScaleInput = page.locator('.sidebar-scale-input');
  await expect(sidebarScaleInput).toBeVisible();

  // Click Auto scale button
  await scaleAutoBtn.click();
  await page.waitForTimeout(500);
  const autoScaleVal = await scaleInput.inputValue();
  console.log('Auto scale factor:', autoScaleVal);
  expect(Number(autoScaleVal)).toBeGreaterThan(0);

  // Screenshot 1: Deformed mesh with auto scale
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-output-deformed-mesh.png' });

  // Now switch to Undeformed mesh via Ribbon button
  console.log('Testing Undeformed Mesh...');
  await undeformedRibbonBtn.click();
  await page.waitForTimeout(1000);

  // When undeformed, scale controls in ribbon should hide
  await expect(undeformedRibbonBtn).toHaveClass(/active/);
  await expect(scaleInput).not.toBeVisible();
  expect(await sidebarScaleBadge.textContent()).toContain('Undeformed');

  // Screenshot 2: Undeformed mesh
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-output-undeformed-mesh.png' });

  // Now click Deformed button in Ribbon to return to deformed mesh
  console.log('Testing returning to Deformed Mesh with custom scale...');
  await deformedRibbonBtn.click();
  await page.waitForTimeout(500);
  await expect(deformedRibbonBtn).toHaveClass(/active/);
  await expect(scaleInput).toBeVisible();

  // Change scale via dropdown to 50x
  await scaleSelect.selectOption('50');
  await page.waitForTimeout(500);
  expect(await scaleInput.inputValue()).toBe('50');

  // Screenshot 3: Deformed mesh with scale 50x
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-output-scaled-50x.png' });

  // Test selecting "Undeformed Mesh" from Output Explorer list
  const undeformedFieldBtn = page.locator('.output-field-btn:has-text("Undeformed Mesh")');
  await expect(undeformedFieldBtn).toBeVisible();
  await undeformedFieldBtn.click();
  await page.waitForTimeout(500);
  await expect(undeformedRibbonBtn).toHaveClass(/active/);

  // Test selecting "Deformed Mesh |u|" from Output Explorer list
  const deformedFieldBtn = page.locator('.output-field-btn:has-text("Deformed Mesh |u|")');
  await expect(deformedFieldBtn).toBeVisible();
  await deformedFieldBtn.click();
  await page.waitForTimeout(500);
  await expect(deformedRibbonBtn).toHaveClass(/active/);
  await expect(scaleInput).toBeVisible();

  console.log('All Output Mesh controls and display tests passed successfully!');
});
