# Auto Mesh and Live Load–Displacement Monitor

## Intent

Make local mesh refinement easy to use in the web workbench and show engineers the equilibrium path while KATAI is solving. Finer elements should be concentrated near loads and structures, with the mesh grading to larger elements farther away. The live chart should show displacement against load and effective stress magnitude at one soil node.

## Goals

- Offer one clear Auto Mesh action that uses KATAI's existing local mesh sizing field around loads, structures, prescribed displacements, and hydraulic lines.
- Keep the current global element size and order as user controls. Show actual mesh node and element counts after preview.
- Stream measurements from accepted, converged solver increments while a job is running, including when a later increment fails.
- Show displacement on X and two series: phase load factor and effective stress magnitude at one monitored node.
- Let the user change the monitored node from the canvas. Initially select the mesh node closest to the midpoint of an active load; if no load is active, use the closest node to the model center.
- Preserve the normal KATAI solver, result loader, and hash checks as the source of final results.

## Non-goals

- Add a second adaptive remeshing algorithm based on a posteriori error estimates.
- Modify solver tolerances, load stepping, or material behavior to make a model converge.
- Present Newton trial iterates as equilibrium states. Only committed increments appear as curve samples.
- Claim an absolute load in kN when the engine has only produced a phase load factor for the current sample.

## Approaches considered

### Mesh

1. **Use the existing local sizing field (recommended).** Enable `mesh.auto_refine`; preserve the project global `elem_size`, element order, local coarseness values, and grading. KATAI already reduces target element size around load and structure entities and transitions to larger elements with distance. This is the smallest path and keeps meshing behavior in the engine.
2. Add error-estimator-driven adaptive remeshing after a solve. This would require repeated solves, result transfer between meshes, and new convergence rules; it adds cost and numerical behavior that the request does not need.

### Live progress

1. **Observe committed solver increments (recommended).** Add a solver observer and stream one sample after each equilibrium increment is committed. The sample includes the monitored node displacement, phase load factor, effective stress magnitude, force residual, and iteration count. The CLI writes progress snapshots to the job directory; the API exposes the latest snapshot; the browser polls it with job status.
2. Parse solver log text. Current CLI output is phase-oriented and is not a stable data contract; it cannot provide node stress or reliable per-increment convergence data.
3. Plot only the completed `.res` file. This does not provide live progress.

## Design

### Auto Mesh

- Add an Auto Mesh action in Input's Mesh mode. It enables `mesh.auto_refine` and runs the engine mesh preview. It does not change the global element size, Tri6/Tri15 order, or user-entered local coarseness values.
- New web projects start with auto refinement enabled, matching KATAI's model default. Imported projects keep their saved setting until the user selects Auto Mesh.
- Existing KATAI entity factors remain authoritative: the mesh builder uses the local coarseness of load/structure objects and the project's grading to form the sizing field. No custom triangulator is added.
- Show the previewed mesh in the canvas and report element order, node count, and element count so the user can spot an overly dense setup before calculating.

### Live graph

- Extend the job progress contract through the engine `Job`, solver increment observer, CLI, web API, and Input/Output UI.
- For each committed increment, publish: phase index/name, increment index, phase load factor, monitored node index and coordinates, node displacement magnitude, 2D effective stress tensor magnitude, force residual, and Newton iteration count.
- Define the available 2D effective stress magnitude from KATAI's recovered nodal effective stress `[σxx, σyy, τxy]` as `sqrt(σxx² + σyy² + 2τxy²)`. Label it as 2D effective stress magnitude.
- Plot node displacement magnitude in metres on X. Plot phase load factor (percent of that phase's target) and stress magnitude (kPa) as two series with separate Y axes. Samples are ordered by solver commit, so the plotted path can show unloading or non-monotone displacement.
- Display the latest residual and iteration count beside the graph; include them in each sample's tooltip. This keeps the selected graph format while making convergence quality inspectable.
- Default the monitor to the nearest generated mesh node at the midpoint of the active load. Add a canvas action to choose another soil node; send its world coordinate when starting the job, then let KATAI resolve it to the generated node.
- Persist progress snapshots beside each job and include them in the authenticated job-status response. The chart can therefore retain completed increments after a phase failure or service restart. The final `.res` still comes from KATAI's existing writer/loader.
- For phase families without a load-controlled mechanical increment observer, show phase status and explain that the curve is unavailable for that phase; do not manufacture points from unrelated time or safety factors.

## Tests

- Engine mesh tests compare local element size near an active load/structure to element size far away with auto refinement enabled, for both Tri6 and Tri15; verify disabling local refinement preserves the global sizing behavior.
- Solver tests verify the observer fires only after a converged increment and reports the committed displacement, load factor, residual, and iteration count.
- CLI/API tests verify progress snapshots are readable during a job, partial samples remain available after a failed phase, and monitor coordinates resolve to the actual generated node.
- Browser tests enable Auto Mesh, inspect the preview, calculate, and verify the live graph updates during the job and retains the completed curve in Output.

## Decisions still left to the implementer

- Use the engine's existing `mesh.auto_refine` local sizing field; do not invent a second mesher.
- Use only committed equilibrium increments as live samples.
- Use the nearest-load-node default with canvas override.
- Label the load series as phase load factor, not kN, until a physically consistent resultant-load definition is available for every supported phase and axisymmetry mode.
