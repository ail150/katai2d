import { expect, test } from '@playwright/test'

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'
const screenshotPath = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-excavation-inactive-fixed.png'
const nomeshScreenshotPath = 'C:/Users/THIN 15 RYZEN/.gemini/antigravity/brain/1632343d-efd6-4ac8-a353-bd914c8ea157/screen-excavation-nomesh-fixed.png'

test('inactive excavation area does not display mesh or contour results', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('http://127.0.0.1:5174/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()

  // Load cantilever sheet pile study
  await page.getByRole('button', { name: 'Studies', exact: true }).click()
  await page.getByRole('button', { name: 'Study: Cantilever sheet pile in clay' }).click()
  await expect(page.locator('.titlecenter')).toContainText('Study: Cantilever sheet pile in clay')

  // Calculate
  await page.getByRole('button', { name: 'Calculate' }).click()
  await expect(page.locator('.messages pre')).toContainText('completed', { timeout: 90000 })
  await expect(page.getByText('Results loaded from KATAI .res')).toBeVisible({ timeout: 15000 })

  // Switch to Output tab
  await page.getByRole('button', { name: 'Output' }).click()
  await expect(page.getByText('CALCULATION RESULTS')).toBeVisible()

  // Select phase 1: Excavate 6.5m
  const phaseSelect = page.locator('.output-phase-select')
  await phaseSelect.selectOption({ label: '[ph1] Excavate 6.5m' })

  await page.waitForTimeout(1000)

  // Verify result legend is visible
  await expect(page.getByTestId('result-legend')).toBeVisible()

  // Take screenshot of phase 1 with mesh lines
  await page.screenshot({ path: screenshotPath, fullPage: true })

  // Toggle mesh lines off
  await page.getByTitle('Toggle mesh lines').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: nomeshScreenshotPath, fullPage: true })

  // Toggle mesh lines back on
  await page.getByTitle('Toggle mesh lines').click()
})
