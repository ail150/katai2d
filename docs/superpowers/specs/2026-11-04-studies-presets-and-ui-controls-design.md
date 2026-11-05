# Geotechnical Studies Presets & Enhanced UI Parameter Controls Design

**Date:** 2026-11-04  
**Author:** Antigravity & User Pair  
**Status:** Approved Architecture (Refined after Builder Review)  
**Target File:** `docs/superpowers/specs/2026-11-04-studies-presets-and-ui-controls-design.md`

---

## 1. Intent & Purpose

KATAI 2D contains a rich suite of geotechnical boundary-value problem tests and numerical studies in `katai2d/tests/` (such as `study_circular_footing.cpp`, `study_wall_benchmark.cpp`, `study_slope_convergence.cpp`, `study_design_ec7.cpp`, etc.). While 26 benchmark files exist under `tests/corpus/*.k2d`, the studies and several key physical test cases currently exist only as C++ source code.

The goal of this project is to:
1. Formulate all canonical geotechnical studies and physical test scenarios into standalone, valid `.k2d` files.
2. Expose these presets in the Web UI through an organized, searchable hierarchical picker.
3. Enhance the Web UI with intuitive parameter controls for boundary conditions, axisymmetry, design factoring, and structural phases.
4. Ensure every preset can be edited, meshed, and computed via the **Calculate** button with live monitor curves and output visualizations.

---

## 2. Scope & Constraints

### 2.1 Goals
- **Preset Library:** Create standalone, calibrated `.k2d` models in `tests/studies/`:
  - `study-circular-footing.k2d`: Rigid circular footing settlement on sand (Axisymmetric, Mohr-Coulomb, K0 + water table + prescribed displacement, reaction force).
  - `study-wall-benchmark.k2d`: Cantilever sheet pile embedded in cohesive soil (Paul/Halder/Mukherjee 2024; $H=6.5\text{ m}$ excavation, $D=5.8\text{ m}$ embedment, $c_u=35\text{ kPa}$, PU-12-240 plate + interface elements + staged excavation, calibrated against `study_wall_benchmark.cpp` with expected $M \approx 35.2\text{ kN}\cdot\text{m}$).
  - `study-slope-convergence.k2d`: Homogeneous 1:2 slope safety analysis (`initial_procedure: 2` Safety / phi-c reduction, target FoS $\approx 1.00$).
  - `study-design-ec7.k2d`: Slope safety analysis under Eurocode 7 DA3 material factoring (`initial_procedure: 2` Safety, `initial.design: 4` for EC7 DA3, target Over-Design Factor $\text{ODF} = \text{FoS} / 1.25 \approx 0.80$, directly matching `test_design_gui.cpp`).
  - `study-foundation-sand.k2d`: Strip load on demo sand (from `study_default_convergence.cpp`).
  - `study-lbb-undrained.k2d`: Saturated block with strip load; Phase 1 tests instantaneous undrained response on sealed block, Phase 2 enables top drainage (`FlowBCType::Head` / `Seepage`) for consolidation dissipation over time.
  - `test-tunnel-ring.k2d`: Circular tunnel excavation and plate lining from `test_tunnel_ring.cpp` (Einstein-Schwartz / Kirsch hoop compression $N \approx 2659\text{ kN/m}$).
  - `test-anchor-retension.k2d`: Prestressed ground anchor from `test_anchor_retension.cpp` (20 × 10 m block with anchor pre-stressed at 300 kN and re-tensioned to 500 kN in Phase 1).
- **UI Preset Navigation:**
  - Enhance the UI `Examples` menu into a categorized browser (Tabs/Sections: *Corpus Benchmarks*, *Geotechnical Studies*, *Structural & Tunneling Cases*) with search filtering and model descriptions.
- **UI Parameter Controls:**
  - **Axisymmetric / Plane Strain Switch:** Visible on Ribbon / Project Properties with clear indicator of radial axis $r=0$.
  - **Edge Boundary Condition Inspector:** Dedicated edge editor showing vertex pairs, mechanical BCType (`Free`, `Normally fixed`, `Horizontally fixed`, `Vertically fixed`, `Fully fixed`), and Flow BCType (`Closed`, `Prescribed head`, `Seepage face`, `Prescribed flux`) instead of comma-separated raw integer arrays.
  - **Expanded Enum Captions:** Add human-readable labels for:
    - Design Approaches (`None`, `EC7 DA1/1`, `EC7 DA1/2`, `EC7 DA2`, `EC7 DA3`, `TBDY 2018 Static`, `TBDY 2018 Seismic`).
    - Flow BC types (`Closed (impermeable)`, `Prescribed head`, `Seepage face`, `Prescribed flux`).
    - Structural actions (Plate line contraction %, Anchor re-tension force).
- **Execution & Calculation:**
  - Clicking **Calculate** runs the KATAI CLI via FastAPI backend.
  - Streaming increments update the live convergence monitor.
  - Deformed mesh, stress/displacement contours, reaction force, and structural force diagrams display in Output.

### 2.2 Non-Goals
- Attempting to convert non-geotechnical C++ algorithmic unit tests (e.g. `test_sparse_matrix.cpp`, `test_delaunay.cpp`, `test_predicates.cpp`, `test_linsolve.cpp`) which do not define physical FE domains.
- Modifying engine solver mechanics or altering benchmark reference solutions.

### 2.3 Anti-Goals
- Hardcoding pre-calculated results in the UI without calling the solver.
- Cluttering the UI with an unmanageable single 40+ item dropdown list.

---

## 3. Architecture & Approaches

### 3.1 Approaches Considered

- **Approach A (Selected): Hierarchical Categorized Presets & Contextual UI Controls**
  - New presets reside in `tests/studies/*.k2d`.
  - Vite eager glob imports both `tests/corpus/*.k2d` and `tests/studies/*.k2d`.
  - UI offers a categorized Preset Dialog / Menu with search and metadata.
  - UI provides structured edge-by-edge BC editing and dedicated axisymmetry toggle.
  - Clean separation between regression benchmark corpus and case studies.

- **Approach B (Rejected): Single Flat Folder & Schema-Only Expansion**
  - Storing all presets in `tests/corpus/` with a single long dropdown.
  - Leaves edge BCs as numeric arrays. Rejected because it impairs usability and mixes regression benchmarks with exploratory case studies.

---

## 4. Detailed Component Design

### 4.1 Presets Specification (`tests/studies/`)

1. **`study-circular-footing.k2d`**:
   - `axisymmetric`: `true`, $x \in [0, 5]$, $y \in [0, 4]$.
   - Material: Sand ($E=1.3\times 10^4$ kPa, $\nu=0.3$, $c=1$ kPa, $\phi=30^\circ$, $\psi=0^\circ$, $\gamma_{unsat}=17$, $\gamma_{sat}=20$).
   - Water: `has_water: true`, $w_x=[0, 5]$, $w_y=[2, 2]$.
   - Initial Procedure: 0 (K0).
   - Phase 1: Prescribed vertical settlement $u_y = -0.05$ m on $x \in [0, 1]$ at $y=4$.
   - Output Verification: $2\pi$ total reaction force and live settlement curve.

2. **`study-wall-benchmark.k2d`**:
   - Domain: Calibrated after `study_wall_benchmark.cpp` ($H=6.5\text{ m}$ excavation, $D=5.8\text{ m}$ embedment, $W=34\text{ m}$, $H_{tot}=18.3\text{ m}$).
   - Plate: $x=15\text{ m}$, $y \in [6\text{ m}, 18.3\text{ m}]$, $EA=2.94\times 10^6$ kN/m, $EI=45360$ kN$\cdot$m$^2$/m.
   - Interfaces: Left and right faces of plate ($R_{inter}=0.67$).
   - Soil: Mohr-Coulomb undrained clay ($c_u=35$ kPa, $E=1.5\times 10^5$ kPa).
   - Initial Phase: K0. Phase 1: Activate plate/interface, excavate cut.
   - Output Verification: Maximum wall bending moment $M \approx 35.2\text{ kN}\cdot\text{m}$.

3. **`study-slope-convergence.k2d`**:
   - Geometry: 1:2 slope, points `(20,20), (70,20), (70,35), (50,35), (30,25), (20,25)`.
   - Material: Mohr-Coulomb ($\gamma=20.2$, $c=3.0$, $\phi=19.6^\circ$).
   - Initial Procedure: 2 (Safety analysis / phi-c reduction).
   - Target FoS: $\approx 1.00$.

4. **`study-design-ec7.k2d`**:
   - Same slope geometry.
   - Initial Procedure: 2 (Safety analysis), `initial.design: 4` (EC7 DA3 material factoring, $\gamma_M=1.25$).
   - Target Over-Design Factor (ODF): $\approx 1.00 / 1.25 = 0.80$.

5. **`study-foundation-sand.k2d`**:
   - $20 \times 10$ m block with flexible crest strip load $q = -100$ kPa over $x \in [9, 11]$.
   - Plastic gravity loading on demo sand.

6. **`study-lbb-undrained.k2d`**:
   - Sealed saturated soil block under crest strip load.
   - Phase 1: Instantaneous undrained loading.
   - Phase 2: Consolidation with top surface drained (`FlowBCType::Head`).

7. **`test-tunnel-ring.k2d`**:
   - Soil block with circular tunnel excavation and plate lining from `test_tunnel_ring.cpp`.
   - Verification: Einstein-Schwartz hoop force $N \approx 2659\text{ kN/m}$.

8. **`test-anchor-retension.k2d`**:
   - 20 × 10 m elastic block from `test_anchor_retension.cpp`.
   - Pre-stressed tieback anchor jacked 300 kN, re-tensioned to 500 kN in Phase 1.

---

### 4.2 Web UI Enhancements (`web/client/src/`)

1. **Preset Modal / Categorized Menu:**
   - Eagerly glob `../../../tests/studies/*.k2d` alongside `../../../tests/corpus/*.k2d`.
   - Organize into categorized tabs:
     - *Corpus Benchmarks* (26 foundational cases)
     - *Geotechnical Studies* (Rigid footing, Cantilever wall, Slope stability, EC7 DA3, Undrained consolidation)
     - *Structural & Tunneling* (Tunnel ring, Anchor retension)
   - Add search filter by name or keyword.

2. **Edge Boundary Condition Editor:**
   - In `App.tsx`, when inspecting a `SoilPolygon`, provide an **Edge Boundary Conditions** section.
   - Lists each edge (e.g. `Edge 1: (0,0) → (20,0)`):
     - Mechanical BC dropdown: `Free`, `Normally fixed`, `Horizontally fixed`, `Vertically fixed`, `Fully fixed`.
     - Flow BC dropdown: `Closed`, `Head`, `Seepage`, `Flux`.
   - Updates `edge_bc` and `edge_flow` arrays cleanly.

3. **Ribbon & Inspector Controls:**
   - Add **Axisymmetric** toggle in Ribbon / Project Explorer header.
   - Expand `enumCaption()` for:
     - `design`: `['None', 'EC7 DA1/1', 'EC7 DA1/2', 'EC7 DA2', 'EC7 DA3', 'TBDY 2018 Static', 'TBDY 2018 Seismic']`
     - `flow_bc`: `['Closed (impermeable)', 'Prescribed head', 'Seepage face', 'Prescribed flux']`

4. **Calculate & Monitor Execution:**
   - Ensure the server validates and calculates all study models through `/api/projects/:id/jobs`.
   - Output tab displays deformed mesh, scalar contours, structural force diagrams (PU-12-240 moments), reaction forces ($2\pi F_y$), and solver diagnostics.

---

## 5. Verification & Testing

1. **Preset Format & Validation:**
   - Run KATAI CLI validation on each `.k2d` file in `tests/studies/`: `katai validate <file>` must return exit code 0.
2. **Solve Verification:**
   - Run `katai calculate <file>` on each study preset in WSL/Linux to confirm convergence and correct physics (e.g. FoS ~ 1.00 for slope, expected moment for wall, reaction for circular footing).
3. **Web UI & E2E Testing:**
   - Add Playwright test in `web/client/e2e/studies.spec.ts` asserting:
     - All studies appear in the categorized Examples browser.
     - Selecting each study imports the project and populates canvas and properties.
     - Changing edge BC and axisymmetry reflects in the model.
     - Clicking Calculate completes and renders Output results.
   - Run `npm run test:e2e` and `npm run build` to confirm zero regression.
