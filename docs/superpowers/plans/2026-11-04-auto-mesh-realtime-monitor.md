# Implementation plan: Auto Mesh and real-time monitor

## Scope

Implement local mesh refinement using KATAI's existing sizing-field controls, and stream committed load-increment samples from the native solver through the CLI and API to an Output-shell graph. Monitor displacement is the horizontal axis; load factor and 2D stress magnitude are separate curves.

## Tasks

- [x] Expose an Auto Mesh action in Input and keep project mesh settings consistent with the generated preview.
- [x] Emit solver increment samples with resolved nearest mesh node, displacement, recovered stress magnitude, residual and iteration count.
- [x] Publish progress snapshots from the CLI and pass optional monitor coordinates through the API job worker.
- [x] Show the live monitor in Output and retain its samples after job completion.
- [x] Add regression coverage and document the workflow.

## Verification

- Linux build: `scripts/build-linux.sh` with `RUN_TESTS=0` — passed, including Linux configuration checks.
- CTest: `test_jobs` and `test_cli` — passed.
- API: `pytest -q web/server/test_app.py` — 9 passed.
- Frontend: `npm run build` — passed.
- Browser E2E: `npm run test:e2e` — 10 passed, including Auto Mesh, live monitor, both Tutorial 1 variants and mesh options.
- `git diff --check` — passed.

## Review notes

- Increment callbacks are placed after the solver commits an accepted step, so rejected attempts do not appear as converged samples. The API test covers preserving the published prefix after a failed process; a native collapse-specific fixture was not added because it would require a new model setup unrelated to the monitor contract.
- Final review was performed by the primary agent because multi-agent delegation is disabled in this session.
