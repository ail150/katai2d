// Phase 3 (plaxis-parity): the Soil material editor is organised into PLAXIS
// tabs (General / Mechanical / Groundwater / Interfaces / Initial). This pins
// that the tabs exist and route the right fields, without changing any field.

import { expect, test, type Page } from '@playwright/test'

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'

async function connectBlank(page: Page) {
  await page.goto('/')
  const token = page.getByPlaceholder('Enter server access token')
  if (await token.isVisible({ timeout: 3000 }).catch(() => false)) {
    await token.fill(ownerToken)
    await page.getByRole('button', { name: 'Connect' }).click()
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()
  await page.getByTitle('New project').click()
  await expect(page.locator('.statusbar')).toContainText('New project created')
}

function field(page: Page, name: string) {
  return page.locator('.properties label.field').filter({
    has: page.locator('span').getByText(name, { exact: true }),
  }).first()
}

test('soil material editor exposes PLAXIS tabs that route fields', async ({ page }) => {
  await connectBlank(page)
  // A new project has one default "Sand" material; open it.
  await page.getByRole('button', { name: 'Soil', exact: true }).click()
  await page.locator('.treeitem').filter({ hasText: 'Sand' }).first().click()

  const tabs = page.locator('.mat-tabs')
  await expect(tabs).toBeVisible()
  for (const t of ['General', 'Mechanical', 'Groundwater', 'Interfaces', 'Initial']) {
    await expect(tabs.getByRole('tab', { name: t })).toBeVisible()
  }

  // General: Model + Drainage selectors present.
  await tabs.getByRole('tab', { name: 'General' }).click()
  await expect(field(page, 'Model')).toBeVisible()
  await expect(field(page, 'Drainage')).toBeVisible()

  // Mechanical (default model = Mohr-Coulomb): E, C, Phi.
  await tabs.getByRole('tab', { name: 'Mechanical' }).click()
  await expect(field(page, 'E')).toBeVisible()
  await expect(field(page, 'C')).toBeVisible()
  await expect(field(page, 'Phi')).toBeVisible()

  // Groundwater: permeability Kx/Ky.
  await tabs.getByRole('tab', { name: 'Groundwater' }).click()
  await expect(field(page, 'Kx')).toBeVisible()
  await expect(field(page, 'Ky')).toBeVisible()

  // Interfaces: Rinter.
  await tabs.getByRole('tab', { name: 'Interfaces' }).click()
  await expect(field(page, 'Rinter')).toBeVisible()

  // Initial: K0 / OCR / POP.
  await tabs.getByRole('tab', { name: 'Initial' }).click()
  await expect(field(page, 'K0')).toBeVisible()
  await expect(field(page, 'OCR')).toBeVisible()
  await expect(field(page, 'POP')).toBeVisible()
})
