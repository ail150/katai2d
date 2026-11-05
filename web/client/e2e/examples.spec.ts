import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const corpusDir = resolve(root, 'tests/corpus')
const examples = readdirSync(corpusDir)
  .filter(name => name.endsWith('.k2d'))
  .sort()
  .map(filename => ({
    filename,
    project: JSON.parse(readFileSync(resolve(corpusDir, filename), 'utf8')) as { name: string },
  }))
const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'

test('all corpus presets appear and import their matching projects', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  const menu = page.locator('.menuposition').filter({ has: page.getByRole('button', { name: 'Examples', exact: true }) }).locator('.menupopup')
  const presetButtons = menu.getByRole('button')
  await expect(presetButtons).toHaveText(examples.map(example => example.project.name))

  for (const example of examples) {
    const importResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/projects/import',
    )
    await menu.getByRole('button', { name: example.project.name, exact: true }).click()
    const response = await importResponse
    expect(response.status(), example.filename).toBe(201)
    expect((await response.json()).project, example.filename).toEqual(example.project)
    await expect(page.locator('.statusbar')).toContainText(`Loaded ${example.project.name}`)
    if (example !== examples.at(-1)) await page.getByRole('button', { name: 'Examples', exact: true }).click()
  }
})
