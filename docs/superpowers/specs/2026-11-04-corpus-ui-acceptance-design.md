# Corpus UI Acceptance — Design

## Intent

Recreate each of the 26 `.k2d` fixtures in `tests/corpus` from a blank project using only the workbench's drawing tools and property editor, then validate, preview its mesh, and calculate it through the UI.

## Findings

- All 26 source fixtures pass `katai validate` and generate meshes; their Tri6/Tri15 order is retained by the engine.
- 25 solver runs exit successfully.
- `kv-fnd-010-prandtl-strip-footing.k2d` is explicitly the “Load to collapse” benchmark. It reaches load factor 0.8563, then the engine reports collapse and exits with code 5. The native `test_collapse_arc` passes.
- The current workbench has canvas tools for soil polygons, structures, loads, displacements, hydraulic lines, water lines, and boreholes; schema-driven properties cover materials and phases. It has no E2E test that rebuilds the corpus from a blank project.

## Proposed behavior

Build an E2E fixture builder that starts with a blank project and uses real canvas clicks to create all spatial entities; then set all non-geometric values through visible property controls, add materials/strata/phases through the UI, save, and compare the saved model with the corresponding source fixture. The corpus files serve only as expected model data; the browser does not import them.

Run Validate, Generate mesh, and Calculate from the visible UI, one model at a time. Require 25 converged result sets with the same mesh order and phase count. For the Prandtl benchmark, require the UI to show a solver-detected collapse near 0.8563 and retain its progress/log; do not falsify convergence by changing the input or solver result.

## Acceptance

- All 26 models can be reconstructed from a new blank project using canvas drawing and schema-backed field editing.
- The saved `.k2d` values match the fixture's project, materials, object geometries, phase settings, loads, and mesh settings within coordinate precision.
- All 26 reach the expected terminal calculation outcome: 25 converged, one intentional collapse report.
- All test projects and results use isolated temporary data; source fixtures and the user's live localhost data are unchanged.
