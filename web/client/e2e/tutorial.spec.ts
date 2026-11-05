import { expect, test, type Page } from '@playwright/test'

const ownerToken = process.env.KATAI_ACCESS_TOKEN || 'katai-playwright-owner-token'

async function fillField(page: Page, name: string, value: string) {
  const row = page.locator('.properties label.field').filter({
    has: page.locator('span').getByText(name, { exact: true }),
  }).first()
  await expect(row).toBeVisible()
  const control = row.locator('input, select')
  if (await control.evaluate(element => element.tagName) === 'SELECT') await control.selectOption(value)
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

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('Canvas is not visible')
  const scale = Math.min(box.width / 5, box.height / 4) * 0.82
  const ox = box.width / 2 - 2.5 * scale
  const oy = box.height / 2 + 2 * scale
  await page.mouse.click(box.x + ox + x * scale, box.y + oy - y * scale)
}

async function drawPolygon(page: Page) {
  await page.getByTitle('Soil polygon').click()
  for (const [x, y] of [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][]) await canvasPoint(page, x, y)
  await page.getByRole('button', { name: 'Finish drawing' }).click()
  await fillField(page, 'Edge bc', '4, 2, 0, 2')
}

async function drawLine(page: Page, tool: string, a: [number, number], b: [number, number]) {
  await page.getByTitle(tool).click()
  await canvasPoint(page, ...a)
  await canvasPoint(page, ...b)
  await page.getByRole('button', { name: 'Finish drawing' }).click()
}

async function connectToBlankProject(page: Page) {
  await page.goto('/')
  await page.getByPlaceholder('Enter server access token').fill(ownerToken)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('PROJECT EXPLORER')).toBeVisible()
  await page.getByTitle('New project').click()
  await expect(page.locator('.statusbar')).toContainText('New project created')
}

async function startBlankProject(page: Page, title: string) {
  await connectToBlankProject(page)
  await page.locator('.projectlabel').click()
  await expect(page.locator('.selected-title')).toBeVisible()
  await fillField(page, 'Name', title)
  await checkField(page, 'Axisymmetric', true)
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await checkField(page, 'Has water', true)
  await fillField(page, 'Wx', '0, 5')
  await fillField(page, 'Wy', '2, 2')
  await fillField(page, 'Elem size', title.includes('flexible') ? '0.5' : '1')
  await fillField(page, 'Order', title.includes('flexible') ? '6' : '15')
  await drawPolygon(page)
  return title.includes('flexible')
}

async function drawRigidFooting(page: Page) {
  await drawLine(page, 'Prescribed displacement', [0, 4], [1, 4])
  await fillField(page, 'Name', 'Rigid footing indentation')
  await checkField(page, 'Set ux', true)
  await checkField(page, 'Set uy', true)
  await fillField(page, 'Uy', '-0.05')
}

async function drawFlexibleFooting(page: Page) {
  await page.getByRole('button', { name: 'Structures' }).click()
  const plates = page.locator('.treefolder').filter({ hasText: 'Plate materials' })
  await plates.getByTitle('Add').click()
  await fillField(page, 'Name', 'Footing')
  await fillField(page, 'EA', '5000000')
  await fillField(page, 'EI', '8500')
  await drawLine(page, 'Structure line', [0, 4], [1, 4])
  await fillField(page, 'Name', 'Footing plate')
  await drawLine(page, 'Distributed load', [0, 4], [1, 4])
  await fillField(page, 'Name', 'Footing load')
  await fillField(page, 'Qy1', '-188')
  await fillField(page, 'Qy2', '-188')
}

async function definePhases(page: Page, flexible: boolean) {
  await page.getByRole('button', { name: 'Staged Construction' }).click()
  await page.getByRole('button', { name: 'Initial phase' }).click()
  await expect(page.locator('.properties label.field').filter({
    has: page.locator('span').getByText('Duration', { exact: true }),
  })).toBeVisible()
  await fillField(page, 'Poly', '1')
  if (flexible) {
    await fillField(page, 'Struct', '0')
    await fillField(page, 'Load', '0')
  } else await fillField(page, 'Disp', '0')
  const phases = page.locator('.treefolder').filter({ hasText: 'Calculation phases' })
  await phases.getByTitle('Add').click()
  await fillField(page, 'Name', flexible ? 'Flexible footing load' : 'Indentation')
  await fillField(page, 'Type', '0')
  await fillField(page, 'Duration', '1')
  await fillField(page, 'Steps', flexible ? '50' : '25')
  await fillField(page, 'Poly', '1')
  if (flexible) {
    await fillField(page, 'Struct', '1')
    await fillField(page, 'Load', '1')
  } else {
    await fillField(page, 'Disp', '1')
  }
}

test('schema editor exposes embedded beam material fields', async ({ page }) => {
  await connectToBlankProject(page)
  await page.getByRole('button', { name: 'Structures' }).click()
  const embedded = page.locator('.treefolder').filter({ hasText: 'Embedded beam materials' })
  await embedded.getByTitle('Add').click()
  await expect(page.locator('.properties label.field').filter({
    has: page.locator('span').getByText('Diameter', { exact: true }),
  })).toBeVisible()
})

test('changing mesh size and element order calculates the selected mesh', async ({ page }) => {
  await connectToBlankProject(page)
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: 'Tutorial 1 · rigid footing' }).click()
  await expect(page.locator('.statusbar')).toContainText('Tutorial 1 - rigid footing')
  await page.getByRole('button', { name: 'Mesh', exact: true }).click()
  await page.getByRole('button', { name: 'Edit mesh settings' }).click()

  const counts: string[] = []
  for (const [order, size] of [['6', '1'], ['15', '0.75']]) {
    await fillField(page, 'Order', order)
    await fillField(page, 'Elem size', size)
    await page.locator('.bottomhead').getByRole('button', { name: 'Generate mesh' }).click()
    await expect(page.locator('.statusbar')).toContainText('Mesh ready', { timeout: 90_000 })
    counts.push((await page.locator('.statusbar').innerText()).match(/\d+ nodes · \d+ elements/)?.[0] ?? '')
    await page.getByRole('button', { name: 'Calculate', exact: true }).click()
    await expect(page.locator('button.run')).toBeDisabled()
    await expect(page.locator('.result-summary')).toContainText('Converged', { timeout: 480_000 })
    const headers = { Authorization: `Bearer ${ownerToken}` }
    const projects = await page.request.get('/api/projects', { headers })
    const projectId = (await projects.json()).find((item: { name: string }) => item.name === 'Tutorial 1 - rigid footing')?.id
    expect(projectId).toBeTruthy()
    const resultResponse = await page.request.get(`/api/projects/${projectId}/results`, { headers })
    expect(resultResponse.status()).toBe(200)
    const phases = (await resultResponse.json()).results.phases
    expect(phases.at(-1).mesh.nodes_per_element).toBe(Number(order))
    if (order === '6') {
      await page.getByRole('button', { name: 'Input', exact: true }).click()
      await page.getByRole('button', { name: 'Mesh', exact: true }).click()
      await page.getByRole('button', { name: 'Edit mesh settings' }).click()
    }
  }
  expect(counts[0]).not.toBe(counts[1])
  await expect(page.locator('.properties')).toContainText('Nodal result table')
})

test('Auto Mesh enables local refinement and previews the generated mesh', async ({ page }) => {
  await connectToBlankProject(page)
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: 'Tutorial 1 · rigid footing' }).click()
  await page.getByRole('button', { name: 'Mesh', exact: true }).click()
  await page.getByRole('button', { name: 'Edit mesh settings' }).click()
  await checkField(page, 'Auto refine', false)

  await page.getByRole('button', { name: 'Auto Mesh', exact: true }).click()
  await expect(page.locator('.properties label.checkfield').filter({
    has: page.locator('span').getByText('Auto refine', { exact: true }),
  }).locator('input')).toBeChecked()
  await expect(page.locator('.statusbar')).toContainText(/Mesh ready · \d+ nodes · \d+ elements/, { timeout: 90_000 })
  await expect(page.locator('.statusbar')).toContainText('Tri15')
})

test('live load-displacement monitor plots committed solver increments', async ({ page }) => {
  await connectToBlankProject(page)
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: 'Tutorial 1 · rigid footing' }).click()
  await page.getByTitle('Monitor point').click()
  await canvasPoint(page, 0.5, 3.5)
  await page.getByRole('button', { name: 'Calculate', exact: true }).click()
  const chart = page.locator('.live-monitor')
  await expect(chart.getByRole('img', { name: 'Load factor and stress by monitored displacement' })).toBeVisible()
  await expect(chart).toHaveAttribute('data-sample-count', /[1-9]\d*/)
  await expect(chart).toContainText('2D effective stress magnitude (kPa)')
  await expect(chart).toContainText('Force residual')
  await expect(chart).toContainText('iterations')
  await expect(chart).toContainText('Node')
})

test('water line drawing updates the groundwater boundary', async ({ page }) => {
  await connectToBlankProject(page)
  const title = `Water line canvas check ${Date.now()}`
  await page.locator('.projectlabel').click()
  await fillField(page, 'Name', title)
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await drawLine(page, 'Water line', [0, 2], [5, 2])
  await page.getByTitle('Save').click()
  await expect(page.locator('.statusbar')).toContainText('saved to server')
  const response = await page.request.get('/api/projects', { headers: { Authorization: `Bearer ${ownerToken}` } })
  const project = (await response.json()).find((item: { name: string }) => item.name === title)
  expect(project).toBeTruthy()
  const detail = await page.request.get(`/api/projects/${project.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  const model = (await detail.json()).project
  expect(model.has_water).toBe(true)
  expect(model.wx).toEqual([0, 5])
  expect(model.wy).toEqual([2, 2])
})

test('borehole point drawing creates a borehole entity', async ({ page }) => {
  await connectToBlankProject(page)
  const title = `Borehole canvas check ${Date.now()}`
  await page.locator('.projectlabel').click()
  await expect(page.locator('.selected-title')).toBeVisible()
  await fillField(page, 'Name', title)
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await page.getByTitle('Snap').click()
  await page.getByTitle('Borehole').click()
  await canvasPoint(page, 1.25, 2)
  await expect(page.locator('.selected-title')).toContainText('Borehole')
  await page.getByTitle('Save').click()
  const response = await page.request.get('/api/projects', { headers: { Authorization: `Bearer ${ownerToken}` } })
  const project = (await response.json()).find((item: { name: string }) => item.name === title)
  const detail = await page.request.get(`/api/projects/${project.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  expect((await detail.json()).project.boreholes[0].x).toBeCloseTo(1.25)
})

test('well and drain line drawing creates a hydraulic object', async ({ page }) => {
  await connectToBlankProject(page)
  const title = `Hydro canvas check ${Date.now()}`
  await page.locator('.projectlabel').click()
  await expect(page.locator('.selected-title')).toBeVisible()
  await fillField(page, 'Name', title)
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await drawLine(page, 'Well / drain', [1, 2], [4, 2])
  await fillField(page, 'Name', 'Mid-height drain')
  await page.getByTitle('Save').click()
  const response = await page.request.get('/api/projects', { headers: { Authorization: `Bearer ${ownerToken}` } })
  const project = (await response.json()).find((item: { name: string }) => item.name === title)
  const detail = await page.request.get(`/api/projects/${project.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  const hydro = (await detail.json()).project.hydros[0]
  expect(hydro.x1).toBe(1)
  expect(hydro.x2).toBe(4)
})

test('selection hits a structural element along its full segment', async ({ page }) => {
  await connectToBlankProject(page)
  await page.locator('.projectlabel').click()
  await fillField(page, 'X max', '5')
  await fillField(page, 'Y max', '4')
  await drawLine(page, 'Structure line', [0, 2], [5, 2])
  await fillField(page, 'Name', 'Long support line')
  await canvasPoint(page, 2.5, 2)
  await expect(page.locator('.selected-title')).toContainText('Long support line')
})

for (const flexible of [false, true]) {
  test(`draws, validates, meshes, calculates, and reviews Tutorial 1 ${flexible ? 'flexible' : 'rigid'} footing`, async ({ page }) => {
    const title = `Tutorial 1 ${flexible ? 'flexible' : 'rigid'} footing from blank`
    const isFlexible = await startBlankProject(page, title)
    if (isFlexible) await drawFlexibleFooting(page)
    else await drawRigidFooting(page)
    await definePhases(page, isFlexible)
    await page.screenshot({ path: `test-results/tutorial1-${isFlexible ? 'flexible' : 'rigid'}-input.png`, fullPage: true })

    await page.getByTitle('Validate').click()
    await expect(page.locator('.messages')).toContainText('satisfies the input contract', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Generate mesh' }).click()
    await expect(page.locator('.statusbar')).toContainText('Mesh ready', { timeout: 90_000 })
    await page.getByRole('button', { name: 'Calculate', exact: true }).click()
    await expect(page.locator('.result-summary')).toContainText('Converged', { timeout: 480_000 })
    const reaction = page.getByTestId('footing-reaction')
    await expect(reaction).toBeVisible()
    const reactionKn = Number(await reaction.getAttribute('data-kn'))
    const reference = flexible ? 590 : 588
    const tolerance = flexible ? 0.05 : 0.2
    expect(reactionKn).toBeGreaterThan(reference * (1 - tolerance))
    expect(reactionKn).toBeLessThan(reference * (1 + tolerance))
    await page.locator('.properties details').filter({ hasText: 'Nodal result table' }).locator('summary').click()
    expect(await page.locator('.nodetable tbody tr').count()).toBeGreaterThan(40)
    await expect(page.getByTestId('result-legend')).toBeVisible()
    await page.getByTitle('Toggle contour lines').click()
    await page.getByTitle('Toggle displacement arrows').click()
    await expect(page.getByTitle('Toggle mesh lines')).toBeVisible()
    await page.screenshot({ path: `test-results/tutorial1-${isFlexible ? 'flexible' : 'rigid'}.png`, fullPage: true })
    await page.getByTitle('Toggle mesh lines').click()
    await page.screenshot({ path: `test-results/tutorial1-${isFlexible ? 'flexible' : 'rigid'}-nomesh.png`, fullPage: true })
    await page.getByTitle('Toggle mesh lines').click()
    if (!isFlexible) {
      await page.getByRole('button', { name: 'Input' }).click()
      await page.locator('.projectlabel').click()
      await fillField(page, 'Name', `${title} revised`)
      await page.getByTitle('Save').click()
      await page.getByRole('button', { name: 'Output' }).click()
      await expect(page.locator('.result-summary')).toHaveCount(0)
    }
  })
}
