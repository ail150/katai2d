# KATAI 2D Web

The web workbench has Input and Output shells. The browser edits ordinary `.k2d` JSON and sends it to the API; validation, mesh generation, calculation, and result decoding all run through the KATAI CLI. Result values are read from KATAI's hash-checked `.res` loader.

## Local development

Build KATAI first (`scripts/build-linux.sh` on Ubuntu). Then:

```sh
cd web/server
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export KATAI_ACCESS_TOKEN=local-development-token
export KATAI_CLI="$(realpath ../../build/ubuntu-24.04/bin/katai)"
export KATAI_DATA_DIR="$(realpath ../data)"
uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
```

In a second terminal:

```sh
cd web/client
npm ci
npm run dev
```

The Vite server proxies `/api` to the local API. Paste the owner token into the connect screen. Projects, logs, and result files persist under `KATAI_DATA_DIR`.

Choose a corpus preset from the **Examples** menu to import that `.k2d` fixture as a new server project. The preset loads into Input; validation, meshing, and calculation remain explicit actions.

## Presets library & geotechnical studies

The top-level **Studies** menu and the **Presets** toolbar button open the categorized preset catalog with real-time keyword search and category filtering across:
- **Geotechnical Studies**:
  - `study-circular-footing.k2d`: Axisymmetric rigid circular footing settlement on sand with water table, reporting integrated axisymmetric reaction force ($R = 2\pi \int r \sigma_{yy} dr$).
  - `study-wall-benchmark.k2d`: Sheet pile excavation in clay with plate bending and soil-structure interface slip.
  - `study-slope-convergence.k2d`: 1:2 slope safety factor calculation via $c$-$\phi$ reduction ($FoS \approx 1.015$).
  - `study-design-ec7.k2d`: Eurocode 7 Design Approach 3 (DA3) safety factoring with partial factors applied to soil strength parameters ($ODF \approx 0.810$).
  - `study-foundation-sand.k2d`: Foundation strip load on demo sand.
  - `study-lbb-undrained.k2d`: Saturated soil block consolidation with drained top boundary.
- **Structural & Tunnel Cases**:
  - `test-tunnel-ring.k2d`: Circular tunnel excavation with 16 plate lining segments and normal/shear interface elements.
  - `test-anchor-retension.k2d`: Multi-stage pre-stressed tieback ground anchor installation and retensioning.
- **Corpus Benchmarks**: All 26 canonical regression fixtures from `tests/corpus`.

## Modeling controls & UI parameter editors

- **Axisymmetric toggle**: The ribbon provides a one-click switch between `Plane Strain (x-y)` and `Axisymmetric (r-z)` analysis modes.
- **Polygon Edge Boundary Conditions**: When selecting any soil polygon in the project explorer, the **Edge Boundary Conditions** editor enables setting per-edge mechanical constraints (Free, Normally fixed, Horizontally fixed, Fully fixed) and groundwater flow conditions (Impervious, Open/seepage, Prescribed head, Inflow/outflow flux).
- **Design codes & seismic standards**: Phase settings include dropdown selections for Eurocode 7 (DA1-1, DA1-2, DA2, DA3), Eurocode 8, and TBDY 2018 (Turkish Building Earthquake Code).
- **Footing reaction display**: Axisymmetric foundation analyses automatically compute and highlight the total integrated vertical reaction force in the Output results summary.

To run the browser acceptance flow on a development machine, install the Playwright Chromium build once with `cd web/client && npx playwright install chromium`, then run `npm run test:e2e`. This includes a corpus flow that rebuilds each `.k2d` in `tests/corpus` from a blank project with canvas drawing and property controls, then validates, meshes, and calculates it through KATAI. It expects 25 converged result sets and the Prandtl strip footing to report its native collapse at about load factor 0.856; that collapse is not full-load convergence. Test data is isolated under a temporary directory. Set `KATAI_CORPUS_FILE` or `KATAI_CORPUS_FILES` to run a smaller selection while debugging.

## Ubuntu 24.04 x86_64 deployment

Point an A/AAAA record for the chosen domain at the server and open inbound TCP 80/443. Clone the repository and run `sudo KATAI_DOMAIN=analysis.example.com KATAI_ACCESS_TOKEN='<long random secret>' web/deploy/install-ubuntu.sh`. Caddy obtains and renews the HTTPS certificate. The API binds only to loopback; the single-owner Bearer token protects every API route, and the service does not expose registration or API docs.

The installer creates the `katai` system user, stores project data under `/var/lib/katai-web`, builds the engine with Ubuntu GCC/Eigen, builds the web bundle, and installs a single-worker systemd service. For upgrades, update the checkout and rerun the build, `npm ci && npm run build`, then restart `katai-web`.

## Auto mesh and live monitor

In **Input ? Mesh**, choose **Auto Mesh** to turn on KATAI's local sizing field and preview the generated mesh. It uses each geometry/load/structure coarseness and mesh grading to refine near analysis features and grow elements farther away; the global element size and Tri6/Tri15 order still set the base mesh.

Choose **Monitor point** on the canvas before Calculate to request a nearby soil node. KATAI resolves the requested coordinate to the nearest generated mesh node and reports that node in Output. With no picked point, the server chooses the midpoint of an active load (or the model center when no load is active). The live graph uses monitored displacement magnitude (m) on X, phase load factor (%) on the left axis, and 2D effective stress magnitude (kPa) on the right. It plots only increments committed by the nonlinear solver; residual and iteration count describe the latest committed increment.
