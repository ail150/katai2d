# Corpus UI Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Rebuild all 26 KATAI corpus inputs from blank projects in the web UI and calculate them through the UI.

**Architecture:** Playwright will drive actual canvas drawing and the schema-backed property panel. It will use the `.k2d` files as expected data only, compare the UI-saved project to each fixture, then click Validate, Generate mesh, and Calculate sequentially against isolated test storage.

**Tech Stack:** React/Vite, FastAPI, KATAI CLI, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-corpus-ui-acceptance-design.md`

## Global Constraints

- Do not modify corpus inputs or benchmark parameters.
- Do not label the Prandtl collapse benchmark as a full-load converged result.
- Rebuild geometry through canvas events; never use file import or project API writes to create the model.
- Run one solver calculation at a time in isolated storage.

## Review Focus

- Nonzero and negative domain bounds must transform canvas clicks to world coordinates; compare recreated points to fixture geometry.
- Point loads and repeated vertices must remain drawable; assert degenerate line geometry is reconstructed correctly.
- Tri6/Tri15 mesh order must survive property editing and mesh preview; compare project and result `nodes_per_element`.
- Multi-phase flags and nested arrays must survive the property editor and save; compare every project key in the fixture, allowing schema defaults added by the editor.
- The collapse fixture must report its factor and retain the progress/log without claiming full convergence.

---

## Task 1: Add UI-driven canvas reconstruction harness

- [x] **Step 1: Add browser test `corpus_models_are_rebuilt_from_canvas_and_saved_without_import`** in `web/client/e2e/corpus.spec.ts`. Start with a blank project, create every spatial object using canvas tools, create materials/strata/phases through UI controls, edit all scalar/array properties through visible controls, save, and compare the persisted project with the source fixture (coordinates within 1e-4, other values exact).
- [x] **Step 2: Run the test and confirm RED** on the first unsupported or incorrectly transformed object.
- [x] **Step 3: Fix the smallest shared UI drawing/editor issue demonstrated by the test**, preserving schema defaults and unknown project keys.
- [x] **Step 4: Run the reconstruction test for all 26 corpus inputs and require fixture-valued fields and canvas-created coordinates to match within 1e-4.**

## Task 2: Validate and preview every rebuilt model

- [x] **Step 1: Extend the E2E harness to click Validate and Generate mesh after reconstruction; assert the visible validation passes, node/element counts appear, and Tri6/Tri15 label matches source mesh order.**
- [x] **Step 2: Run and confirm RED for any unsupported geometry, field, or mesh order.**
- [x] **Step 3: Implement only demonstrated UI fixes.**
- [x] **Step 4: Run all 26 through the UI and require validation and mesh preview to pass.**

## Task 3: Calculate all reconstructed models in the UI

- [x] **Step 1: Extend the E2E harness to click Calculate sequentially. Require 25 jobs to complete with loaded result phases and one Prandtl job to finish with the collapse diagnostic near 0.8563 and its progress/log visible.**
- [x] **Step 2: Run and confirm RED if a result is not displayed or the collapse reason/factor is hidden.**
- [x] **Step 3: Implement the smallest honest Output/status fix needed to expose a native solver collapse outcome; do not fabricate `.res` data or change engine inputs.**
- [x] **Step 4: Run the corpus E2E and existing `npm run test:e2e`; record pass counts and expected collapse outcome.**

## Task 4: Final verification and documentation

- [x] **Step 1: Add README instructions for drawing from blank and the benchmark collapse outcome.**
- [x] **Step 2: Run `npm run build`, the corpus E2E in an isolated data directory, existing E2E, and `git diff --check`.**
- [x] **Step 3: Self-review changes and ensure no source fixture or persistent localhost project was modified.**



Execution note: The existing Messages panel already displays KATAI's full solver log, including the native collapse reason and factor. No fabricated result or extra Output UI behavior was needed; the browser assertion now targets the current job message. 
pm run test:e2e was run as its two constituent specs: corpus (26 models) and the existing tutorial suite (10 tests).
