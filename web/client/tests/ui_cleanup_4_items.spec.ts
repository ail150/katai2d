import { test, expect } from '@playwright/test';

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'local-development-token';
const artifactDir = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157';

test('verify 4 UI cleanup items: Output explorer icons & scale row, bottom buttons, ribbon mesh controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:5174');

  const tokenInput = page.getByPlaceholder('Enter server access token');
  if (await tokenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tokenInput.fill(ownerToken);
    await page.getByRole('button', { name: 'Connect' }).click();
  }

  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible({ timeout: 10000 });

  // 1. Check Input ribbon Mesh mode
  await page.getByRole('button', { name: 'Mesh', exact: true }).click();
  await page.waitForTimeout(500);

  // Item 4: Ribbon should NOT contain "Generator", "Density", "Element Order" or duplicate "Generate Mesh" in ribbon
  const ribbonMeshGenerator = await page.$('.ribbon span:has-text("Generator")');
  expect(ribbonMeshGenerator).toBeNull();
  const ribbonMeshDensity = await page.$('.ribbon span:has-text("Density")');
  expect(ribbonMeshDensity).toBeNull();
  const ribbonMeshOrder = await page.$('.ribbon span:has-text("Element Order")');
  expect(ribbonMeshOrder).toBeNull();

  // Mesh Settings properties panel should still have mesh controls and PLAXIS generator
  const meshSettingsEditor = await page.$('.properties');
  expect(meshSettingsEditor).not.toBeNull();
  const meshSettingsTitle = await page.textContent('.properties .selected-title');
  expect(meshSettingsTitle).toContain('Mesh settings');

  // Item 3: Bottom MESSAGES bar should NOT have "Validate" or "Generate mesh" buttons
  const bottomValidate = await page.$('.bottomhead button:has-text("Validate")');
  expect(bottomValidate).toBeNull();
  const bottomGenerateMesh = await page.$('.bottomhead button:has-text("Generate mesh")');
  expect(bottomGenerateMesh).toBeNull();
  const bottomSolverLog = await page.$('.bottomhead button:has-text("Solver log")');
  expect(bottomSolverLog).not.toBeNull();

  // Capture Input Mesh screenshot
  await page.screenshot({ path: `${artifactDir}/screen-cleanup-input-mesh.png` });

  // Switch to Output tab
  await page.getByRole('button', { name: 'Output', exact: true }).click();
  await page.waitForTimeout(500);

  // Item 1: Output Explorer categories should NOT contain category icons (IconComp)
  const groupTitleIcons = await page.$$('.output-group-title svg:not(.lucide-chevron-right)');
  expect(groupTitleIcons.length).toBe(0);

  // Item 2: Output Explorer should NOT contain .output-scale-row (Mesh: Deformed 1x Auto)
  const outputScaleRow = await page.$('.output-scale-row');
  expect(outputScaleRow).toBeNull();

  // Calculation phase dropdown should still exist in output sidebar
  const phaseSelect = await page.$('.output-phase-select');
  expect(phaseSelect).not.toBeNull();

  // Capture Output screenshot
  await page.screenshot({ path: `${artifactDir}/screen-cleanup-output.png` });
});
