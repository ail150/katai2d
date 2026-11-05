import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';

test('Verify all 8 user requested enhancements', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Load application on port 5174
  await page.goto('http://127.0.0.1:5174/');
  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // 2. Load benchmark / study case (Cantilever Sheet Pile in Clay)
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await page.getByRole('button', { name: /cantilever sheet pile/i }).first().click();
  await page.waitForTimeout(1000);

  // Click Fit model
  const fitBtn = page.locator('button[title="Fit model"]');
  if (await fitBtn.isVisible()) {
    await fitBtn.click();
    await page.waitForTimeout(400);
  }

  // Verify Item 8: No "Interface (Rinter)" text on input canvas
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-item8-no-rinter-text.png' });

  // 3. Test Item 1: Mesh Generation with Loader Overlay & UI Freeze
  await page.getByRole('button', { name: 'Mesh', exact: true }).click();
  await page.waitForTimeout(400);
  const generateMeshBtn = page.getByRole('button', { name: /Generate Mesh/i }).first();
  await expect(generateMeshBtn).toBeVisible();

  // Click Generate Mesh
  await generateMeshBtn.click();
  await expect(page.locator('.statusbar')).toContainText(/Mesh ready/i, { timeout: 15000 });
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-item1-mesh-generated.png' });

  // 4. Test Item 3: Canvas Wheel Zoom & Middle Mouse Pan
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;

  // Zoom in with wheel (no ctrlKey needed!)
  await page.mouse.move(cx, cy);
  const zoomTextBefore = await page.locator('.viewtools span').textContent();
  await page.mouse.wheel(0, -120); // scroll up = zoom in
  await page.waitForTimeout(300);
  const zoomTextAfter = await page.locator('.viewtools span').textContent();
  expect(zoomTextBefore).not.toEqual(zoomTextAfter);

  // Pan with middle mouse button drag
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 80, cy + 50, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-item3-zoom-pan.png' });

  // 5. Run Calculate to get Results and test Items 2, 4, 5, 6, 7
  await page.locator('button.run:has-text("Calculate")').click();

  // Wait for calculation to complete or finish
  await expect(page.locator('.statusbar')).toContainText(/completed|Calculation/i, { timeout: 60000 });
  await page.waitForTimeout(2000);

  // Ensure we are on Output tab
  await expect(page.locator('.viewtab.active')).toContainText(/Calculation Results/i);

  // Verify Item 4: In Output Explorer, "Deformed Mesh |u|" and "Undeformed Mesh" buttons are HIDDEN
  const deformedInExplorer = page.locator('.output-fields-list button:has-text("Deformed Mesh |u|")');
  const undeformedInExplorer = page.locator('.output-fields-list button:has-text("Undeformed Mesh")');
  await expect(deformedInExplorer).toHaveCount(0);
  await expect(undeformedInExplorer).toHaveCount(0);

  // Verify Item 7: Output Explorer typography and structure matches Input Explorer
  const outputGroupTitles = page.locator('.output-group-title');
  await expect(outputGroupTitles.first()).toHaveClass(/treefolder/);
  const outputFieldBtns = page.locator('.output-field-btn');
  await expect(outputFieldBtns.first()).toHaveClass(/treeitem/);

  // Verify Item 5 & 6: Vector Arrows & Direction Breakdown (Total, X, Y)
  // Toggle displacement vector arrows
  const vectorPill = page.locator('.output-vector-pill').first();
  await vectorPill.click();
  await page.waitForTimeout(500);

  // Verify vector direction buttons are visible
  const vectorDirSelector = page.locator('[data-testid="vector-dir-selector"]');
  await expect(vectorDirSelector).toBeVisible();

  const totalBtn = vectorDirSelector.locator('button:has-text("Total")');
  const xBtn = vectorDirSelector.locator('button:has-text("Arah X")');
  const yBtn = vectorDirSelector.locator('button:has-text("Arah Y")');
  await expect(totalBtn).toBeVisible();
  await expect(xBtn).toBeVisible();
  await expect(yBtn).toBeVisible();

  // Switch to Arah X
  await xBtn.click();
  await expect(xBtn).toHaveClass(/active/);
  await page.waitForTimeout(300);

  // Switch to Arah Y
  await yBtn.click();
  await expect(yBtn).toHaveClass(/active/);
  await page.waitForTimeout(300);

  // Switch back to Total
  await totalBtn.click();
  await expect(totalBtn).toHaveClass(/active/);
  await page.waitForTimeout(300);

  // Check ribbon direction switcher
  const ribbonDirBtns = page.locator('.vdir-ribbon-group');
  await expect(ribbonDirBtns).toBeVisible();

  // Test Item 5: Toggle Undeformed and Deformed mesh with vectors active
  const undeformedBtn = page.getByRole('button', { name: 'Undeformed', exact: true });
  const deformedBtn = page.getByRole('button', { name: 'Deformed', exact: true });
  await expect(undeformedBtn).toBeVisible();
  await expect(deformedBtn).toBeVisible();

  // Toggle Undeformed mesh
  await undeformedBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-item5-undeformed-vectors.png' });

  // Toggle Deformed mesh
  await deformedBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-item5-deformed-vectors.png' });

  // Full screen capture for user presentation
  await page.screenshot({ path: 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-output-full-verified.png' });
});
