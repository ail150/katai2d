import { expect, test, type Locator, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Dict = Record<string, any>
const engineBooleanDefaults: Record<string, boolean> = {
  tension_cutoff: true, dilatancy_cutoff: false, k0nc_auto: true, jraniso: false,
  rinter_rigid: true, k0_auto: true, elastoplastic: false, punch: false,
  has_head: true, iface_pos: false, iface_neg: false, hinge1: false, hinge2: false,
  set_ux: false, set_uy: true, flowpore: false, cloadstart: false,
  water_override: false, ignoreund: false, resetsmall: false, resetdisp: false, headramp: false,
  auto_refine: true, corner_refine: true,
}
const root = resolve(import.meta.dirname, '../../..')
const corpusDir = resolve(root, 'tests/corpus')
const allFiles = readdirSync(corpusDir).filter(name => name.endsWith('.k2d')).sort()
const files = process.env.KATAI_CORPUS_FILES?.split(',') || (process.env.KATAI_CORPUS_FILE ? [process.env.KATAI_CORPUS_FILE] : allFiles)
const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'
const bands: Record<string, string> = {
  materials: 'Soil', polygons: 'Soil', strata: 'Soil', boreholes: 'Soil',
  structs: 'Structures', plates: 'Structures', anchors: 'Structures', geogrids: 'Structures', embedded: 'Structures',
  loads: 'Structures', disps: 'Structures',
  hydros: 'Flow Conditions', phases: 'Staged Construction',
}
const entityButtons: Record<string, string> = {
  materials: 'Soil materials', polygons: 'Soil polygons', strata: 'Strata', boreholes: 'Boreholes',
  structs: 'Structures', plates: 'Plate materials', anchors: 'Anchor materials', geogrids: 'Geogrid materials', embedded: 'Embedded beam materials',
  loads: 'Loads', disps: 'Prescribed displacements', hydros: 'Wells and drains', phases: 'Calculation phases',
}
// CAD toolbar button titles in the current UI (App.tsx cad-toolbar).
const toolFor: Record<string, string> = {
  polygons: 'Toolbar: Soil Region', structs: 'Toolbar: Plate Structure', loads: 'Toolbar: Surface Load',
  disps: 'Toolbar: Prescribed Disp', hydros: 'Toolbar: Water Drain/Well',
}

function labelFor(key: string) {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
}

async function field(page: Page, name: string): Promise<Locator> {
  const row = page.locator('.properties label.field').filter({ has: page.locator('span').getByText(labelFor(name), { exact: true }) }).first()
  if (!await row.count()) throw new Error(`field ${name} missing in ${await page.locator('.selected-title').innerText()}; visible fields: ${(await page.locator('.properties label span').allTextContents()).join(', ')}`)
  await expect(row, `property ${name}`).toBeVisible()
  return row.locator('input, select')
}

async function setFields(page: Page, value: Dict) {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || (Array.isArray(item) && item.length > 0 && typeof item[0] === 'object')) continue
    if (typeof item === 'boolean') {
      const row = page.locator('.properties label.checkfield').filter({ has: page.locator('span').getByText(labelFor(key), { exact: true }) }).first()
      await expect(row, `property ${key}`).toBeVisible()
      await row.locator('input').setChecked(item)
    } else if (Array.isArray(item)) {
      await (await field(page, key)).fill(item.join(', '))
    } else if (typeof item === 'object') {
      await setFields(page, item)
    } else {
      const control = await field(page, key)
      if (await control.evaluate(element => element.tagName) === 'SELECT') await control.selectOption(String(item))
      else await control.fill(String(item))
    }
  }
}

async function setDomainPoint(page: Page, x: number, y: number, project: Dict, origin: [number, number]) {
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas is not visible')
  const xmin = Number(project.x_min), xmax = Number(project.x_max), ymin = Number(project.y_min), ymax = Number(project.y_max)
  const base = Math.min(box.width / (xmax - xmin), box.height / (ymax - ymin)) * 0.82
  const sx = box.width / 2 - (xmin + xmax) / 2 * base + (x - origin[0]) * base
  const sy = box.height / 2 + (ymin + ymax) / 2 * base - (y - origin[1]) * base
  await page.mouse.click(box.x + sx, box.y + sy)
}

async function draw(page: Page, project: Dict, key: string, object: Dict, index: number) {
  await page.getByRole('button', { name: bands[key], exact: true }).click()
  const tool = toolFor[key]
  await page.getByTitle(tool).click()
  const origin: [number, number] = [0, 0]
  if (key === 'polygons') {
    for (let i = 0; i < object.x.length; i++) await setDomainPoint(page, object.x[i], object.y[i], project, origin)
  } else {
    let x1 = Number(object.x1), y1 = Number(object.y1), x2 = Number(object.x2), y2 = Number(object.y2)
    // A zero-length load is first placed as a short canvas line, then edited to its exact point.
    if (x1 === x2 && y1 === y2) x2 += Math.max(1e-3, (project.x_max - project.x_min) / 100)
    await setDomainPoint(page, x1, y1, project, origin)
    await setDomainPoint(page, x2, y2, project, origin)
  }
  await page.getByRole('button', { name: 'Finish drawing' }).click()
  await expect(page.locator('.selected-title')).toBeVisible()
  await setFields(page, object)
  expect(index).toBeGreaterThanOrEqual(0)
}

async function createListObject(page: Page, key: string, value: Dict, index: number) {
  await page.getByRole('button', { name: bands[key], exact: true }).click()
  const folder = page.locator('.treefolder').filter({ hasText: entityButtons[key] }).first()
  if (key === 'materials' && index === 0) {
    await folder.locator('xpath=..').locator('.treeitem').first().click()
  } else {
    await folder.getByTitle('Add').click()
  }
  await setFields(page, value)
}

async function fillPhase(page: Page, model: Dict, key: 'initial' | 'phases', value: Dict, index: number) {
  await page.getByRole('button', { name: 'Staged Construction', exact: true }).click()
  if (key === 'initial') {
    await page.getByRole('button', { name: 'Initial phase', exact: true }).click()
  } else {
    const folder = page.locator('.treefolder').filter({ hasText: 'Calculation phases' }).first()
    await folder.getByTitle('Add').click()
  }
  await setFields(page, value)
}

async function rebuild(page: Page, model: Dict) {
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST')
  await page.getByTitle('New project').click()
  const created = await (await createdResponse).json()
  const id = created.id as string
  await page.locator('.projectlabel').click()
  const projectFields = Object.fromEntries(Object.entries(model).filter(([key, value]) =>
    !['materials', 'plates', 'anchors', 'geogrids', 'embedded', 'strata', 'boreholes', 'polygons', 'structs', 'loads', 'disps', 'hydros', 'initial', 'phases'].includes(key) &&
    !(key === 'wx' || key === 'wy') && value !== undefined,
  ))
  await setFields(page, projectFields)
  await page.getByRole('button', { name: 'Mesh', exact: true }).click()
  await setFields(page, model.mesh)
  const snap = page.getByTitle('Snap')
  if ((await snap.getAttribute('class') || '').includes('selected')) await snap.click()

  for (let i = 0; i < (model.materials || []).length; i++) await createListObject(page, 'materials', model.materials[i], i)
  for (const key of ['plates', 'anchors', 'geogrids', 'embedded'] as const) {
    for (let i = 0; i < (model[key] || []).length; i++) await createListObject(page, key, model[key][i], i)
  }
  for (const key of ['polygons', 'structs', 'loads', 'disps', 'hydros'] as const) {
    for (let i = 0; i < (model[key] || []).length; i++) await draw(page, model, key, model[key][i], i)
  }
  if (model.has_water && model.wx?.length >= 2) {
    await page.getByRole('button', { name: 'Flow Conditions', exact: true }).click()
    await page.getByTitle('Phreatic Water Line').click()
    for (let i = 0; i < model.wx.length; i++) await setDomainPoint(page, model.wx[i], model.wy[i], model, [0, 0])
    await page.getByRole('button', { name: 'Finish drawing' }).click()
    await page.locator('.projectlabel').click()
    await setFields(page, { wx: model.wx, wy: model.wy })
  }
  for (let i = 0; i < (model.strata || []).length; i++) await createListObject(page, 'strata', model.strata[i], i)
  for (let i = 0; i < (model.boreholes || []).length; i++) {
    const borehole = model.boreholes[i]
    await page.getByRole('button', { name: 'Soil', exact: true }).click()
    await page.getByTitle('Toolbar: Stratum Borehole').click()
    await setDomainPoint(page, borehole.x, borehole.level, model, [0, 0])
    await setFields(page, borehole)
  }
  await fillPhase(page, model, 'initial', model.initial, 0)
  for (let i = 0; i < (model.phases || []).length; i++) await fillPhase(page, model, 'phases', model.phases[i], i)
  await page.getByTitle('Save').click()
  await expect(page.locator('.statusbar')).toContainText('saved to server')
  const detail = await page.request.get(`/api/projects/${id}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  return { id, project: (await detail.json()).project as Dict }
}

function expectFixtureValues(actual: any, expected: any, path = '$') {
  if (Array.isArray(expected)) {
    if (expected.length === 0 && actual === undefined) return
    expect(actual, path).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) expectFixtureValues(actual[i], expected[i], `${path}[${i}]`)
  } else if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) expectFixtureValues(actual?.[key], value, `${path}.${key}`)
  } else if (actual === undefined && typeof expected === 'boolean' && engineBooleanDefaults[path.split('.').at(-1)!] === expected) {
    return
  } else if (typeof expected === 'number') {
    if (typeof actual !== 'number') throw new Error(`${path}: expected ${expected}, got ${String(actual)}`)
    expect(actual, path).toBeCloseTo(expected, 4)
  } else {
    expect(actual, path).toEqual(expected)
  }
}

test('all corpus models can be rebuilt from canvas and edited in the workbench', async ({ page }) => {
  test.setTimeout(1_200_000)
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()
  for (const filename of files) {
    const model = JSON.parse(readFileSync(resolve(corpusDir, filename), 'utf8')) as Dict
    const { id, project } = await rebuild(page, model)
    expectFixtureValues(project, model, filename)
    expect(project.mesh.grading, `${filename} mesh grading`).toBe(model.mesh.grading ?? 0.15)
    expect(project.mesh.corner_refine, `${filename} corner refinement`).toBe(model.mesh.corner_refine ?? true)
    for (let i = 0; i < (model.materials || []).length; i++) {
      expect(project.materials[i].tension_cutoff ?? true, `${filename} material ${i} tension cutoff`).toBe(model.materials[i].tension_cutoff ?? true)
    }
    for (let i = 0; i < (model.structs || []).length; i++) {
      expect(project.structs[i].iface_vt ?? 0.1, `${filename} structure ${i} interface thickness`).toBe(model.structs[i].iface_vt ?? 0.1)
    }

    await page.getByTitle('Validate').click()
    await expect(page.locator('.messages pre.ok')).toContainText('satisfies the input contract', { timeout: 30_000 })
    await page.getByTitle('Generate Mesh using PLAXIS Auto-Mesher').click()
    await expect(page.locator('.statusbar')).toContainText(new RegExp(`Mesh ready · \\d+ nodes · \\d+ elements · Tri${model.mesh.order}`), { timeout: 90_000 })
    const jobResponsePromise = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/projects/${id}/jobs`,
    )
    await page.getByRole('button', { name: 'Calculate', exact: true }).click()
    const jobResponse = await jobResponsePromise
    expect(jobResponse.status()).toBe(202)
    const startedJob = await jobResponse.json() as Dict
    await expect.poll(async () => {
      const response = await page.request.get(`/api/jobs/${startedJob.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
      return response.ok() ? (await response.json()).status : `HTTP ${response.status()}`
    }, { timeout: 480_000 }).toMatch(/^(completed|failed)$/)
    await expect(page.locator('.statusbar')).toContainText(/completed|failed/, { timeout: 30_000 })

    const headers = { Authorization: `Bearer ${ownerToken}` }
    const resultResponse = await page.request.get(`/api/projects/${id}/results`, { headers })
    if (filename === 'kv-fnd-010-prandtl-strip-footing.k2d') {
      await expect(page.locator('.messages pre').last()).toContainText(/collapse/i)
      await expect(page.locator('.messages pre').last()).toContainText(/0\.856/)
      await expect(page.locator('.live-monitor')).toHaveAttribute('data-sample-count', /[1-9]\d*/)
      expect(resultResponse.status()).toBe(404)
    } else {
      await expect(page.locator('.result-summary')).toContainText('Converged')
      expect(resultResponse.status()).toBe(200)
      const results = (await resultResponse.json()).results.phases as Dict[]
      expect(results).toHaveLength(1 + (model.phases || []).length)
      expect(results.at(-1)?.mesh.nodes_per_element).toBe(model.mesh.order)
    }
  }
})
