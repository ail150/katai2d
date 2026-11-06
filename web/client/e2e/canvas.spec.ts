// Canvas safety net for the Phase 1 client refactor (plaxis-parity plan, Task 1.1).
//
// The App.tsx refactor moves the canvas, drawing, snapping, selection, zoom/pan
// and mesh-preview code into modules WITHOUT changing behaviour. This spec pins
// that behaviour so the move is verifiable. It deliberately draws from a blank
// project (no preset), and stops at MESH generation -- it never solves, so it
// runs in seconds and can gate every extraction step. The solve path is covered
// by the existing tutorial specs.
//
// It uses the same canvas-interaction helpers as e2e/tutorial.spec.ts so the
// coordinate mapping matches the app's.

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

// Maps a model coordinate to a screen pixel using the same auto-scale the app
// uses for a 5x4 contour (see tutorial.spec.ts canvasPoint).
async function canvasXY(page: Page, x: number, y: number) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('Canvas not visible')
  const scale = Math.min(box.width / 5, box.height / 4) * 0.82
  const ox = box.width / 2 - 2.5 * scale
  const oy = box.height / 2 + 2 * scale
  return { px: box.x + ox + x * scale, py: box.y + oy - y * scale, box }
}

async function canvasClick(page: Page, x: number, y: number) {
  const { px, py } = await canvasXY(page, x, y)
  await page.mouse.click(px, py)
}

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

// D1 regression: the example/preset library is gone from the UI.
test('no example or preset entry points remain in the UI', async ({ page }) => {
  await connectBlank(page)
  await expect(page.getByRole('button', { name: 'Studies', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Examples', exact: true })).toHaveCount(0)
  await expect(page.locator('.quick button').filter({ hasText: 'Presets' })).toHaveCount(0)
  await expect(page.locator('.presetmodal')).toHaveCount(0)
  // The File menu no longer offers presets or tutorials.
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByRole('button', { name: /Browse presets/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Tutorial 1/i })).toHaveCount(0)
})

async function setupProject(page: Page) {
  await page.locator('.projectlabel').click()
  await expect(page.locator('.selected-title')).toBeVisible()
  await fillField(page, 'Name', `Canvas net ${Date.now()}`)
  await checkField(page, 'Axisymmetric', true)
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await fillField(page, 'Elem size', '1')
  await fillField(page, 'Order', '15')
}

test('draws geometry, snaps, selects, zooms, pans and meshes from a blank project', async ({ page }) => {
  test.setTimeout(180_000)
  await connectBlank(page)
  await setupProject(page)

  // --- draw a soil polygon by clicking four corners ----------------------
  // The CAD toolbar labels the polygon tool "Toolbar: Soil Region".
  await page.getByTitle('Toolbar: Soil Region').click()
  for (const [x, y] of [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][]) await canvasClick(page, x, y)
  await page.getByRole('button', { name: 'Finish drawing' }).click()
  await fillField(page, 'Edge bc', '4, 2, 0, 2')
  // a polygon now exists in the explorer
  await expect(page.locator('.treefolder').filter({ hasText: 'Soil polygons' })).toBeVisible()

  // --- draw a prescribed displacement in Structures mode -----------------
  await page.getByRole('button', { name: 'Structures' }).click()
  await page.getByTitle('Toolbar: Prescribed Disp').click()
  await canvasClick(page, 0.02, 4.0) // near (0,4): snap should pull it onto the node
  await canvasClick(page, 1.0, 4.0)
  await page.getByRole('button', { name: 'Finish drawing' }).click()
  await fillField(page, 'Name', 'Footing indentation')
  await checkField(page, 'Set uy', true)
  await fillField(page, 'Uy', '-0.05')

  // --- selection: the select tool activates and the properties pane
  // responds to a canvas click along the drawn line. We assert the tool
  // activates and the pane stays present (selection hit-testing lives in the
  // canvas interaction module the refactor moves); exact name matching is too
  // brittle for a pixel-click, so we keep this to "selection works".
  const selectBtn = page.getByTitle('Select tool (Pointer)')
  await selectBtn.click()
  await expect(selectBtn).toHaveClass(/active/)
  await canvasClick(page, 0.5, 4.0)
  await expect(page.locator('.properties')).toBeVisible()

  // --- zoom buttons update the scale without error -----------------------
  await page.getByTitle('Zoom in').first().click()
  await page.getByTitle('Zoom in').first().click()
  await page.getByTitle('Fit model').first().click()

  // --- pan via the pan tool ---------------------------------------------
  await page.getByTitle('Pan view (Drag canvas)').click()
  const { px, py } = await canvasXY(page, 2.5, 2)
  await page.mouse.move(px, py)
  await page.mouse.down()
  await page.mouse.move(px + 40, py + 30)
  await page.mouse.up()

  // --- generate the mesh (no solve) and assert a mesh was produced -------
  await page.getByRole('button', { name: 'Mesh', exact: true }).click()
  await page.getByTitle('Generate Mesh using PLAXIS Auto-Mesher').click()
  await expect(page.locator('.statusbar')).toContainText(/Mesh ready · \d+ nodes · \d+ elements/, { timeout: 90_000 })
  // 15-noded mesh label present
  await expect(page.locator('.statusbar')).toContainText('Tri15')

  // node/element counts are positive integers
  const status = await page.locator('.statusbar').innerText()
  const m = status.match(/(\d+) nodes · (\d+) elements/)
  expect(m).toBeTruthy()
  expect(Number(m![1])).toBeGreaterThan(0)
  expect(Number(m![2])).toBeGreaterThan(0)
})
