# Geotechnical Studies Presets & Enhanced UI Parameter Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create standalone `.k2d` presets for all canonical geotechnical studies and key physical tests, integrate an organized categorized preset browser in the Web UI, add dedicated UI parameter controls (Edge Boundary Conditions, Axisymmetry switch, Design Code factoring), and ensure every preset calculates properly via the UI.

**Architecture:** Create valid `.k2d` files in `tests/studies/`. In the React/Vite client, bundle both `tests/corpus/*.k2d` and `tests/studies/*.k2d`, expose them through a categorized and searchable preset picker, enhance the property inspector with edge-by-edge mechanical and hydraulic boundary condition controls, and verify end-to-end calculation and result visualization via Playwright.

**Tech Stack:** C++20 KATAI CLI, JSON Schema, React 18, Vite, TypeScript, Playwright, Python FastAPI.

**Spec:** `docs/superpowers/specs/2026-11-04-studies-presets-and-ui-controls-design.md`

## Global Constraints

- Every preset must conform to `.k2d` schema version 29 and validate cleanly with `katai validate`.
- Presets must be self-contained JSON with exact coordinates, materials, boundary conditions, and calculation phases.
- Do not modify existing benchmark files in `tests/corpus/*.k2d` or existing tutorial workflows in `web/examples/`.
- The Web UI must preserve the existing single-owner token authorization and project save/import APIs.
- All 8 new study presets must execute and produce results (or proper limit collapse diagnostics) upon pressing **Calculate**.

## Review Focus

- The Axisymmetric switch must properly set `project.axisymmetric` and correctly trigger $2\pi F_y$ reaction integration in Output when calculating circular footings.
- The Edge Boundary Condition editor must correctly map local edges $k \to k+1$ to `edge_bc` and `edge_flow` without desynchronizing array lengths or corrupting vertex order.
- The Eurocode 7 DA3 slope study (`study-design-ec7.k2d`) must execute `Safety` phase with `design: 4` and report an Over-Design Factor (ODF) $\approx 0.80$ ($1.00 / 1.25$).
- The sheet pile wall study (`study-wall-benchmark.k2d`) must compute wall bending moments through the plate element and display them in the Output structure forces panel.
- The Preset Browser must remain easily navigable on standard desktop viewports (using tabbed categories and search filter).

---

### Task 1: Create and validate the `.k2d` study preset files

**Files:**
- Create: `tests/studies/study-circular-footing.k2d`
- Create: `tests/studies/study-wall-benchmark.k2d`
- Create: `tests/studies/study-slope-convergence.k2d`
- Create: `tests/studies/study-design-ec7.k2d`
- Create: `tests/studies/study-foundation-sand.k2d`
- Create: `tests/studies/study-lbb-undrained.k2d`
- Create: `tests/studies/test-tunnel-ring.k2d`
- Create: `tests/studies/test-anchor-retension.k2d`
- Test: `tests/test_studies_presets.py`

**Interfaces:**
- Consumes: KATAI CLI executable (`katai validate <file>` and `katai calculate <file>`).
- Produces: 8 valid `.k2d` files in `tests/studies/`.

- [ ] **Step 1: Write the validation test for all study presets**
  Create `tests/test_studies_presets.py` that discovers all `tests/studies/*.k2d`, asserts that at least 8 presets exist, and runs `katai validate` on each file expecting exit code 0.

- [ ] **Step 2: Run test to verify it fails**
  Run: `python tests/test_studies_presets.py`
  Expected: FAIL (no files in `tests/studies/` yet).

- [ ] **Step 3: Author the 8 calibrated `.k2d` study preset files**
  - `study-circular-footing.k2d`: Axisymmetric, $R=5$ m, $H=4$ m, sand ($E=1.3\times 10^4$ kPa, $\nu=0.3$, $c=1$ kPa, $\phi=30^\circ$), water table at $y=2$ m, K0 initial phase, prescribed vertical settlement $u_y=-0.05$ m on $x \in [0, 1]$.
  - `study-wall-benchmark.k2d`: $W=34$ m, $H_{tot}=18.3$ m, excavation cut $6.5$ m, plate PU-12-240 from $y=6$ to $18.3$ m, interface $R_{inter}=0.67$, undrained clay $c_u=35$ kPa, staged excavation phase.
  - `study-slope-convergence.k2d`: 1:2 slope, Mohr-Coulomb, `initial_procedure: 2` (Safety).
  - `study-design-ec7.k2d`: 1:2 slope, `initial_procedure: 2`, `initial.design: 4` (EC7 DA3).
  - `study-foundation-sand.k2d`: $20 \times 10$ m block with crest strip load $q=-100$ kPa.
  - `study-lbb-undrained.k2d`: Saturated block under strip load; Phase 1 undrained sealed, Phase 2 consolidation dissipation.
  - `test-tunnel-ring.k2d`: Circular tunnel excavation and plate lining from `test_tunnel_ring.cpp`.
  - `test-anchor-retension.k2d`: 20 × 10 m block with prestressed ground anchor jacked from 300 to 500 kN.

- [ ] **Step 4: Run test to verify it passes**
  Run: `python tests/test_studies_presets.py`
  Expected: PASS (all 8 files validate with 0 errors).

- [ ] **Step 5: Verify solver calculation on study presets**
  Run KATAI CLI calculate in WSL/Linux for `study-slope-convergence.k2d` (FoS ~ 1.00), `study-design-ec7.k2d` (ODF ~ 0.80), and `study-circular-footing.k2d`. Confirm convergence.

---

### Task 2: Implement Categorized Preset Browser in Web UI

**Files:**
- Modify: `web/client/src/App.tsx`
- Modify: `web/client/src/style.css`

**Interfaces:**
- Consumes: `rawCorpusExamples` from `../../../tests/corpus/*.k2d` and `rawStudyExamples` from `../../../tests/studies/*.k2d`.
- Produces: Categorized preset selector with tabs (*Corpus Benchmarks*, *Geotechnical Studies*, *Structural & Tunneling Cases*) and search input.

- [ ] **Step 1: Bundle study presets alongside corpus in `App.tsx`**
  Use `import.meta.glob('../../../tests/studies/*.k2d', {eager:true, query:'?raw', import:'default'})`. Parse and categorize presets into:
  - `Corpus Benchmarks` (26 cases)
  - `Geotechnical Studies` (6 cases)
  - `Structural & Tunnel Cases` (2 cases)

- [ ] **Step 2: Add Preset Dialog / Categorized Menu component in `App.tsx`**
  Add interactive preset modal or tabbed dropdown menu that allows switching categories, typing a search query to filter by name/description, and clicking to load the preset via `loadExample()`.

- [ ] **Step 3: Add CSS styling in `style.css`**
  Style the category tabs, search input bar, and preset card list with max height and smooth scrolling.

- [ ] **Step 4: Verify manual loading and bundling**
  Run `npm run build` in `web/client` to verify Vite bundles both glob patterns cleanly.

---

### Task 3: Enhance UI Parameter Controls (Edge BCs, Axisymmetry, Enums)

**Files:**
- Modify: `web/client/src/App.tsx`
- Modify: `web/client/src/style.css`

**Interfaces:**
- Consumes: `project.axisymmetric`, `SoilPolygon.edge_bc`, `SoilPolygon.edge_flow`, `SoilPolygon.edge_head`, `phase.design`.
- Produces: Visual ribbon switch for Axisymmetry, structured per-edge BC editor, and expanded enum labels.

- [ ] **Step 1: Add Axisymmetric Ribbon Switch & Indicator**
  In the ribbon or project header, add an explicit toggle button for Axisymmetric ($r-z$) vs Plane Strain ($x-y$). When enabled, indicate that $x=0$ represents the symmetry axis $r=0$.

- [ ] **Step 2: Implement dedicated Edge Boundary Condition Editor**
  In `renderFields` (or dedicated polygon inspector component), when inspecting a `SoilPolygon`, display each boundary segment:
  `Edge k (x1, y1) → (x2, y2)` with:
  - Mechanical BC dropdown: `0 · Free`, `1 · Normally fixed`, `2 · Horizontally fixed`, `3 · Vertically fixed`, `4 · Fully fixed`.
  - Groundwater Flow BC dropdown: `0 · Closed (impermeable)`, `1 · Prescribed head`, `2 · Seepage face`, `3 · Prescribed flux`.
  Updating either dropdown safely updates `edge_bc[k]` and `edge_flow[k]`.

- [ ] **Step 3: Expand `enumCaption()` for design codes and flow conditions**
  In `enumCaption`:
  - `design`: `['None', 'EC7 DA1/1', 'EC7 DA1/2', 'EC7 DA2', 'EC7 DA3', 'TBDY 2018 Static', 'TBDY 2018 Seismic']`
  - `flow_bc` / `edge_flow`: `['Closed (impermeable)', 'Prescribed head', 'Seepage face', 'Prescribed flux']`

- [ ] **Step 4: Run Vite build check**
  Run: `npm run build` in `web/client` to ensure TypeScript types and JSX compile cleanly.

---

### Task 4: End-to-End Verification with Playwright

**Files:**
- Create: `web/client/e2e/studies.spec.ts`
- Modify: `web/README.md`

**Interfaces:**
- Consumes: Running backend API server (`app.py`) and Vite dev server.
- Produces: Automated browser test suite asserting preset discovery, loading, parameter editing, meshing, and calculating.

- [ ] **Step 1: Write browser test `e2e/studies.spec.ts`**
  - Verify all 8 study presets appear in their respective categories in the Examples browser.
  - Test loading `study-circular-footing.k2d`: assert Axisymmetric is true, click Generate mesh, click Calculate, wait for completion, and assert total footing reaction is displayed.
  - Test loading `study-slope-convergence.k2d`: assert Safety initial phase, click Calculate, verify FoS $\approx 1.00$.
  - Test loading `study-design-ec7.k2d`: verify `design: 4` (EC7 DA3), calculate and verify ODF $\approx 0.80$.
  - Test loading `study-wall-benchmark.k2d`: verify plate and interface presence, calculate and verify wall moment diagram in Output.
  - Test editing an edge boundary condition from the UI and saving.

- [ ] **Step 2: Run browser tests**
  Run: `npx playwright test e2e/studies.spec.ts --workers=1`
  Expected: PASS

- [ ] **Step 3: Run full existing regression suite**
  Run: `npx playwright test e2e/tutorial.spec.ts e2e/examples.spec.ts --workers=1`
  Expected: PASS (all existing tutorials and 26 corpus models still pass).

- [ ] **Step 4: Update `web/README.md` documentation**
  Add instructions describing the new Geotechnical Studies presets, Axisymmetric mode, and Edge Boundary Condition editor.

