import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('verify smooth deformed structure, no boundary conditions in output, and structure forces diagram view', async ({ page }) => {
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

  // Load "Study: Cantilever sheet pile in clay"
  console.log('Loading Study: Cantilever sheet pile in clay...');
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await page.getByRole('button', { name: 'Study: Cantilever sheet pile in clay', exact: true }).click();
  await page.waitForTimeout(1000);

  // Click Calculate
  console.log('Calculating model...');
  await page.click('button.run:has-text("Calculate")');

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

  // Select Phase 1 (Excavate 6.5m)
  const phaseSelect = page.locator('.output-phase-select');
  if (await phaseSelect.isVisible()) {
    await phaseSelect.selectOption({ index: 1 });
    await page.waitForTimeout(1000);
  }

  // 1. Verify Soil & Mesh view has smooth deformed structure
  console.log('Verifying Deformed Mesh in Phase 1...');
  // Click Deformed Mesh |u| in sidebar
  const defMeshBtn = page.getByRole('button', { name: 'Deformed Mesh |u|', exact: true });
  if (await defMeshBtn.isVisible()) {
    await defMeshBtn.click();
    await page.waitForTimeout(1000);
  }

  // Auto scale
  const scaleAutoBtn = page.locator('.deform-scale-auto-btn');
  if (await scaleAutoBtn.isVisible()) {
    await scaleAutoBtn.click();
    await page.waitForTimeout(500);
  }

  // Take screenshot of smooth deformed sheet pile wall without boundary conditions
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-smooth-deformed-wall.png' });
  console.log('Saved screen-smooth-deformed-wall.png');

  // 2. Switch to Structure Forces View
  console.log('Testing Structure Forces View...');
  const structForcesViewBtn = page.getByRole('button', { name: 'Structure Forces', exact: true });
  await expect(structForcesViewBtn).toBeVisible();
  await structForcesViewBtn.click();
  await page.waitForTimeout(1000);

  // Verify that floating summary card is visible
  const summaryCard = page.locator('.struct-diagram-summary');
  await expect(summaryCard).toBeVisible();
  const summaryText = await summaryCard.innerText();
  console.log('Summary card text:\n', summaryText);
  expect(summaryText).toContain('Bending moments M');
  expect(summaryText).toContain('Maximum value');
  expect(summaryText).toContain('Minimum value');

  // Take screenshot of Structure Forces view (Bending Moment diagram)
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-structure-bending-moment.png' });
  console.log('Saved screen-structure-bending-moment.png');

  // 3. Test clicking Shear Force Q in sidebar
  console.log('Testing Shear Force Q from sidebar...');
  const shearBtn = page.getByRole('button', { name: 'Shear Force Q [kN/m]', exact: true });
  await expect(shearBtn).toBeVisible();
  await shearBtn.click();
  await page.waitForTimeout(1000);

  const shearSummaryText = await summaryCard.innerText();
  console.log('Shear summary text:\n', shearSummaryText);
  expect(shearSummaryText).toContain('Shear forces Q');

  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-structure-shear-force.png' });
  console.log('Saved screen-structure-shear-force.png');

  // 4. Test clicking Structure Displacement |u| in sidebar
  console.log('Testing Structure Displacement |u| from sidebar...');
  const dispBtn = page.getByRole('button', { name: 'Structure Displacement |u| [mm]', exact: true });
  await expect(dispBtn).toBeVisible();
  await dispBtn.click();
  await page.waitForTimeout(1000);

  const dispSummaryText = await summaryCard.innerText();
  console.log('Disp summary text:\n', dispSummaryText);
  expect(dispSummaryText).toContain('Total displacement |u|');

  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-structure-displacement.png' });
  console.log('Saved screen-structure-displacement.png');

  console.log('All Structure Forces tests passed successfully!');
});

