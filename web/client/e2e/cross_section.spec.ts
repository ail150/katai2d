// Phase 5 (plaxis-parity): the Output Cross section tool samples the active
// result field along a line and exports it. This draws the rigid footing (fast
// solve), calculates, then places a section and asserts the profile panel.

import { expect, test, type Page } from '@playwright/test'

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'

async function fillField(page: Page, name: string, value: string) {
  const row = page.locator('.properties label.field').filter({
    has: page.locator('span').getByText(name, { exact: true }),
  }).first()
  await expect(row).toBeVisible()
  const control = row.locator('input, select')
  if (await control.evaluate(el => el.tagName) === 'SELECT') await control.selectOption(value)
  else await control.fill(value)
}

async function checkField(page: Page, name: string, value: boolean) {
  const row = page.locator('.properties label.checkfield').filter({
    has: page.locator('span').getByText(name, { exact: true }),
  }).first()
  await expect(row).toBeVisible()
  const input = row.locator('input')
  if (await input.isChecked() !== value) await input.setChecked(value)
}

async function canvasClick(page: Page, x: number, y: number) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('Canvas not visible')
  const scale = Math.min(box.width / 5, box.height / 4) * 0.82
  const ox = box.width / 2 - 2.5 * scale
  const oy = box.height / 2 + 2 * scale
  await page.mouse.click(box.x + ox + x * scale, box.y + oy - y * scale)
}

test('cross section samples the result field and offers CSV export', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  const token = page.getByPlaceholder('Enter server access token')
  if (await token.isVisible({ timeout: 3000 }).catch(() => false)) {
    await token.fill(ownerToken)
    await page.getByRole('button', { name: 'Connect' }).click()
  }
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()
  await page.getByTitle('New project').click()
  await expect(page.locator('.statusbar')).toContainText('New project created')

  // Rigid footing (axisymmetric) — a fast solve.
  await page.locator('.projectlabel').click()
  await checkField(page, 'Axisymmetric', true)
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await fillField(page, 'Elem size', '1')
  await fillField(page, 'Order', '15')
  await page.getByTitle('Toolbar: Soil Region').click()
  for (const [x, y] of [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][]) await canvasClick(page, x, y)
  await page.getByRole('button', { name: 'Finish drawing' }).click()
  await fillField(page, 'Edge bc', '4, 2, 0, 2')
  // A surface load solves under the default K0 initial procedure (a prescribed
  // displacement would need gravity-loading, which the engine correctly refuses).
  await page.getByRole('button', { name: 'Structures' }).click()
  await page.getByTitle('Toolbar: Surface Load').click()
  await canvasClick(page, 0, 4)
  await canvasClick(page, 1, 4)
  await page.getByRole('button', { name: 'Finish drawing' }).click()
  await fillField(page, 'Qy1', '-188')
  await fillField(page, 'Qy2', '-188')

  await page.getByRole('button', { name: 'Calculate', exact: true }).click()
  // The cross-section tool works on any computed result (we need a mesh + field,
  // not necessarily a converged collapse). Wait until a result summary is shown.
  await expect(page.locator('.result-summary')).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('.shellswitch button.on')).toHaveText(/Output/)

  // Place a cross section across the loaded zone.
  await page.getByTestId('cross-section-toggle').click()
  await canvasClick(page, 0.5, 2)
  await canvasClick(page, 4.5, 2)

  const panel = page.getByTestId('cross-section-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Cross section')
  await expect(panel.getByRole('button', { name: 'CSV' })).toBeVisible()
  await expect(panel.locator('.section-plot polyline')).toBeVisible()
})
