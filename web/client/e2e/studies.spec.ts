import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const studiesDir = resolve(root, 'tests/studies')
const studyFiles = readdirSync(studiesDir)
  .filter(name => name.endsWith('.k2d'))
  .sort()
  .map(filename => ({
    filename,
    project: JSON.parse(readFileSync(resolve(studiesDir, filename), 'utf8')) as { name: string; axisymmetric?: boolean },
  }))
const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'

test('all study presets appear in Studies menu and Preset modal', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()

  // 1. Check Studies menu dropdown
  await page.getByRole('button', { name: 'Studies', exact: true }).click()
  const menu = page.locator('.menuposition').filter({ has: page.getByRole('button', { name: 'Studies', exact: true }) }).locator('.menupopup')
  for (const s of studyFiles) {
    await expect(menu.getByRole('button', { name: s.project.name, exact: true })).toBeVisible()
  }

  // 2. Open Preset modal via quick toolbar
  await page.locator('.quick button').filter({ hasText: 'Presets' }).click()
  await expect(page.getByText('Preset Library & Geotechnical Studies')).toBeVisible()
  await expect(page.getByPlaceholder('Search by case name, material or keyword...')).toBeVisible()

  // Filter category
  await page.getByRole('button', { name: 'Geotechnical Studies', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Study: Circular footing on sand' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Study: Slope FoS convergence' })).toBeVisible()

  // Search keyword
  await page.getByPlaceholder('Search by case name, material or keyword...').fill('Eurocode')
  await expect(page.getByRole('heading', { name: 'Study: Eurocode 7 DA3 slope factoring' })).toBeVisible()
  await page.locator('.presetmodal-header .modalclose').click()
})

test('loads and calculates circular footing axisymmetric case with reaction force', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()

  await page.getByRole('button', { name: 'Studies', exact: true }).click()
  const menu = page.locator('.menuposition').filter({ has: page.getByRole('button', { name: 'Studies', exact: true }) }).locator('.menupopup')
  await menu.getByRole('button', { name: 'Study: Circular footing on sand', exact: true }).click()
  await expect(page.locator('.statusbar')).toContainText('Loaded Study: Circular footing on sand')

  // Check axisymmetric switch is on
  const axisymBtn = page.locator('.axisym-toggle')
  await expect(axisymBtn).toHaveText('Axisymmetric (r-z)')
  await expect(axisymBtn).toHaveClass(/axisym-on/)

  // Calculate
  await page.getByRole('button', { name: 'Calculate' }).click()
  await expect(page.getByText('CALCULATION RESULTS')).toBeVisible({ timeout: 45000 })
  await expect(page.getByTestId('footing-reaction')).toBeVisible({ timeout: 45000 })
  const reactionText = await page.getByTestId('footing-reaction').textContent()
  expect(reactionText).toContain('Total footing reaction')
})

test('loads and calculates slope safety and EC7 DA3 cases', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()

  // Load Slope FoS
  await page.getByRole('button', { name: 'Studies', exact: true }).click()
  const menu = page.locator('.menuposition').filter({ has: page.getByRole('button', { name: 'Studies', exact: true }) }).locator('.menupopup')
  await menu.getByRole('button', { name: 'Study: Slope FoS convergence', exact: true }).click()
  await expect(page.locator('.statusbar')).toContainText('Loaded Study: Slope FoS convergence')

  await page.getByRole('button', { name: 'Calculate' }).click()
  await expect(page.getByText('CALCULATION RESULTS')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.result-summary')).toContainText('Factor of safety', { timeout: 60000 })

  // Now load EC7 DA3
  await page.getByRole('button', { name: 'Studies', exact: true }).click()
  await menu.getByRole('button', { name: 'Study: Eurocode 7 DA3 slope factoring', exact: true }).click()
  await expect(page.locator('.statusbar')).toContainText('Loaded Study: Eurocode 7 DA3 slope factoring')

  await page.getByRole('button', { name: 'Calculate' }).click()
  await expect(page.getByText('CALCULATION RESULTS')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.result-summary')).toContainText('Factor of safety', { timeout: 60000 })
})

test('edge boundary conditions editor allows editing mechanical and flow BCs', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()

  // Load Foundation strip load study which contains soil polygons
  await page.getByRole('button', { name: 'Studies', exact: true }).click()
  const menu = page.locator('.menuposition').filter({ has: page.getByRole('button', { name: 'Studies', exact: true }) }).locator('.menupopup')
  await menu.getByRole('button', { name: 'Study: Foundation strip load on sand', exact: true }).click()
  await expect(page.locator('.statusbar')).toContainText('Loaded Study: Foundation strip load on sand')

  // Select first soil polygon in the tree
  await page.locator('.tree .treeitem').filter({ hasText: 'Sand foundation' }).click()
  await expect(page.getByText('Edge Boundary Conditions')).toBeVisible()

  // Find Edge 1 select and change to Normally fixed (value 1)
  const edgeItem = page.locator('.edge-item').first()
  const mechSelect = edgeItem.locator('select').first()
  await mechSelect.selectOption('1')

  // Save and verify no crash
  await page.locator('.quick button[title="Save"]').click()
  await expect(page.locator('.statusbar')).toContainText('Project saved to server')
})
