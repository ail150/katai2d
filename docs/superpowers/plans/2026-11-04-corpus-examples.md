# Corpus Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make all 26 `tests/corpus/*.k2d` files selectable and loadable as project presets in the web UI.

**Architecture:** Vite bundles the fixtures as raw JSON at build time. A top-level Examples menu lists fixture project names in stable filename order; selecting one uses the existing `/api/projects/import` route. The popup scrolls within the viewport and does not duplicate fixture files or add a backend endpoint.

**Tech Stack:** React, Vite, TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-corpus-examples-design.md`

## Global Constraints

- Include every `*.k2d` file in `tests/corpus`, sorted by name for stable menu ordering.
- Preserve current tutorial examples and project import behavior.
- Do not calculate examples automatically or change fixture contents.

## Review Focus

- Every corpus fixture appears once in the Examples menu, including names with punctuation and spaces; the E2E compares the menu entries with fixture metadata.
- Loading any entry imports its matching project JSON through the existing API; the E2E captures import responses and checks every project name.
- The 26-entry menu stays usable in a desktop viewport; the CSS caps its height and enables scrolling.
- Production builds contain the corpus data without leaving source-only filesystem URLs; `npm run build` verifies Vite resolves the raw glob.

---

### Task 1: Bundle and load corpus examples from the UI

**Files:**
- Modify: `web/client/src/App.tsx`
- Modify: `web/client/src/style.css`
- Create: `web/client/e2e/examples.spec.ts`
- Modify: `web/README.md`

**Interfaces:**
- Consumes: Existing `request('/api/projects/import', ...)` and tutorial `loadExample` flow in `App.tsx`.
- Produces: A top-level Examples menu with one button per fixture; selecting a button imports that fixture and sets the project in Input.

- [x] **Step 1: Add the failing browser test** `all corpus presets appear and import their matching projects`. Read the 26 source fixture names in the test, connect to the owner API, assert each exact name is in the Examples menu, select each entry, and assert the import response's project matches the fixture.
- [x] **Step 2: Run the test to verify RED.** Run `npx playwright test e2e/examples.spec.ts --workers=1`; expect it to fail because the Examples menu does not exist yet.
- [x] **Step 3: Bundle and expose presets.** In `App.tsx`, use Vite's eager raw glob for `../../../tests/corpus/*.k2d`, parse and sort fixtures by filename, add the Examples top-level menu, and pass selected JSON through the existing project import flow. Keep the two Tutorial 1 actions in File. In `style.css`, cap the menu popup height at 70vh and enable vertical scrolling.
- [x] **Step 4: Add the README usage note.** Explain that the top-level Examples menu loads corpus presets as server projects and that Calculate remains an explicit action.
- [x] **Step 5: Run the browser test and production build.** Run `npx playwright test e2e/examples.spec.ts --workers=1` and `npm run build`; expect 26 preset imports and a successful Vite production bundle.
- [x] **Step 6: Run the existing tutorial E2E and whitespace check.** Run `npx playwright test e2e/tutorial.spec.ts --workers=1` and `git diff --check`; expect the tutorial entries and existing workflows to remain intact.
