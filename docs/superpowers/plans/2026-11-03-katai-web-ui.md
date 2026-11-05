# KATAI 2D Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver engineering Input and Output web shells backed by KATAI, buildable on Ubuntu 24.04 x86_64, with both Tutorial 1 footing variants calculable.

**Architecture:** A React/TypeScript single-origin browser app talks to a FastAPI service. The service persists canonical `.k2d` projects and launches `katai` as a per-job subprocess; the CLI owns validation, meshing, solving, and `.res` decoding. Caddy serves HTTPS and protects the single-owner app.

**Tech Stack:** C++20/CMake/GCC/Eigen, Python 3.12/FastAPI, React/TypeScript/Vite, browser Canvas 2D, Caddy/systemd.

**Spec:** Approved user plan in the conversation (2026-11-03).

## Global Constraints

- Ubuntu 24.04 x86_64 is the supported Linux deployment target; use GCC and the Eigen backend, retaining Windows support.
- The engine remains the sole source of numerical results; do not reimplement validation, meshing, or solving in the web stack.
- Preserve `.k2d` and `.res` version/hash checks; never display stale or corrupt results as current.
- Cover every KATAI project field and supported result family; unsupported capabilities are out of scope.
- Single owner, private server-side project storage, HTTPS, no public registration, desktop-first layout.
- Keep all user actions real: no placeholder toolbar buttons or silent field loss.

## Review Focus

- A `.res` file must be rejected when truncated, corrupt, newer than the reader, or stale for the selected project.
- A project path or upload name must not escape its private server data directory.
- Invalid or clamped `.k2d` input must never reach the solver worker as a successful calculation.
- Drawing and snapping must preserve model coordinates across viewport resize, zoom, and pan.
- An interrupted/restarted web service must not report a running or successful job without a recoverable result file.

---

### Task 1: Ubuntu build and CI

**Files:** `CMakePresets.json`, `scripts/build-linux.sh`, `.github/workflows/ci-linux.yml`, targeted CMake test configuration.

**Interfaces:** Produces an `ubuntu-24.04` configure/build preset using GCC, Ninja, `KATAI_WITH_MKL=OFF`, and Python bindings; produces a Linux CLI binary named `katai`.

- [ ] Add a Linux preset test/check for the expected generator, compiler, and Eigen configuration; verify it fails before the preset exists.
- [ ] Add the preset and a Linux build script that configures, builds, runs CTest, and reports the CLI path.
- [ ] Add Ubuntu 24.04 CI using the same preset and retain the existing Windows CI unchanged.
- [ ] Run a focused Linux configure/build and the Linux CTest suite; fix portability issues exposed by GCC.

### Task 2: CLI mesh and result interchange

**Files:** `cli/main.cpp`, `tests/test_cli.cpp`, `kernel/api/include/katai/api/katai.hpp` and API implementation as required.

**Interfaces:** `katai mesh <file.k2d>` emits JSON containing mesh node coordinates, triangle connectivity, and region/material identity. `katai results <file.k2d> <file.res>` emits JSON for shared mesh topology and every phase's supported result arrays, summaries, force stations, and diagnostics. Existing `validate` and `solve --out` behavior remains compatible.

- [ ] Add CLI tests for a valid mesh JSON response, a solve/results round trip, a stale model hash, a malformed result file, and usage/file error exit codes; run them to observe expected failures.
- [ ] Expose mesh generation through the public KATAI facade without solving a phase.
- [ ] Implement JSON output with finite-number handling and correct string escaping, reusing `load_results` and its hash guard.
- [ ] Run CLI tests and the existing CLI identity test.

### Task 3: Private project API and CLI worker

**Files:** `studio/server/`, `studio/server/tests/`, `studio/server/requirements.txt`.

**Interfaces:** Same-origin HTTP API for project create/list/read/update/delete, `.k2d` import/export, validate, mesh, calculate, job status/cancel, and results. One solver child runs at a time; job records and files persist under a configured private data root.

- [ ] Write failing tests for path-safe project storage, auth enforcement, CLI invocation/exit mapping, one-at-a-time jobs, cancellation, restart recovery, and result retrieval.
- [ ] Implement the FastAPI service, single-owner login/session, private file store, queue and CLI subprocess adapter.
- [ ] Use argument arrays (never shell interpolation), validate before solve, preserve stdout/stderr and phase progress, and mark interrupted jobs honestly.
- [ ] Run server tests with a fake CLI, then integration tests against the built KATAI binary.

### Task 4: Input and Output shells

**Files:** `studio/web/`, `studio/web/tests/`.

**Interfaces:** React app consumes the API and canonical KATAI JSON; Canvas 2D uses model-space coordinates. Input exposes Soil, Structures, Mesh, Flow Conditions, and Staged Construction modes. Output reads only API-returned KATAI mesh/results.

- [ ] Add failing UI tests for shell navigation, schema round-trip, canvas coordinate transforms/snapping, object selection/editing, phase activation, and result field selection.
- [ ] Implement the desktop-first Input shell: menu/toolbar, project and phase explorers, central drawable canvas, property inspector, mode strip, grid/snap, pan/zoom, select/delete, polygons/regions, boreholes, structures, loads, prescribed displacements, wells/drains, and water lines.
- [ ] Implement conditional editors for all KATAI materials, mesh settings, structures, hydraulic inputs, and phase controls; preserve unknown project keys on import/export.
- [ ] Implement the Output shell with deformed mesh, contours, displacement arrows, legends, tables, structural/interface forces, phase summaries, diagnostics, and available time-series plots.
- [ ] Run frontend unit/component tests, production build, and accessibility checks for keyboard operation and readable focus states.

### Task 5: Tutorial 1 acceptance and Ubuntu deployment

**Files:** `studio/e2e/`, `studio/deploy/`, `.github/workflows/ci-linux.yml`, `README.md`.

**Interfaces:** Tutorial 1 acceptance covers the rigid indentation and flexible plate/load models from a blank UI project through results. Deployment uses systemd for the API and Caddy for HTTPS/reverse proxy.

- [ ] Add browser-driven acceptance tests that draw, validate, mesh, calculate, and inspect both variants; compare the axisymmetric total reaction/load scale with the approximately 588–590 kN reference.
- [ ] Add a same-origin production-serving smoke test and verify project/result persistence, auth, refusal messaging, and interrupted worker recovery.
- [ ] Add Ubuntu service/Caddy configuration and environment documentation for domain, password, data directory, and CLI path.
- [ ] Run full verification: Linux CTest, server tests, frontend tests/build, both browser acceptance calculations, and deployment configuration checks.

