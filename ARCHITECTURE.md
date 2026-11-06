# KATAI 2D — Architecture

This document records the decisions that shape the engine, and the exceptions
that were made on the way. It is the file eight source headers point at, so it
is kept honest: every claim here is checked against the tree by a gate, and the
gates are named.

Where this document and the code disagree, the code is right and this document
is a bug.

---

## 1. The shape of the system

KATAI 2D is a 2D plane-strain / axisymmetric geotechnical finite element
engine. It is built in four layers, and **dependencies point downward only**.

| Layer | Modules | What lives there |
|---|---|---|
| 1 — engine | `math`, `linsolve`, `geometry`, `mesh`, `materials`, `fem`, `analysis`, `model`, `io` | The physics, the mesh, the schema, the file formats. Everything needed to compute and reproduce an analysis. |
| 2 — execution | `jobs` | The seam a project becomes a run: mesh from the project's own settings, phases through the driver, results back. `Job`, `mesh_from_project`, the flow driver. |
| 3 — published API | `api` | The single facade (`katai/api/katai.hpp`) a front end programs against. |
| 4 — front ends | `cli`, `python`, `web` | The CLI binary, the Python package, the browser app. Each is a composition root: it holds no physics. |

`kernel/` is the engine and layers 1–3. `cli/`, `python/` and `web/` are layer 4.

The layer contract is **machine-enforced**: `scripts/check_architecture.py`
fails the build when a module includes one from a layer above it, when two
modules on the same layer include each other in a cycle, when a layer-1 module
defines a physics symbol (a stiffness matrix, an element state, a solver
iteration), or when a front end includes anything but the facade and the jobs
layer. It is registered as the ctest entry `check_architecture`, so a violation
is a red build, not a review comment.

### Why layers at all

The point of a published facade is not tidiness. It is that a front end
**cannot** change the answer. When the CLI, the Python package and the web app
all reach the engine through one header, a change to the way a phase is solved
changes all of them together — and the cross-process test in `tests/test_cli.cpp`
compares the `.res` the native binary writes against an in-process `Job` run
byte for byte, which is what turns "they should agree" into "they do agree, or
the build is red".

---

## 2. Data-oriented design: no vtable on the hot path

`kernel/materials/include/katai/materials/material_model.hpp` and
`kernel/fem/include/katai/fem/elements/element_traits.hpp` both state the
same decision: **there are no virtual calls on the hot path.**

The constitutive models are not polymorphic objects. A material is a flat,
tagged descriptor — a struct of plain fields plus a `SoilModel` enum — and
dispatch on it is a `switch` over the tag, resolved at compile time wherever
the compiler can see the tag, and at runtime (a jump table, no indirect call)
where it cannot. Element behaviour is the same: `element_traits.hpp` selects
element type by compile-time template dispatch, not by a virtual `Element`
base.

The reason is arithmetic, not taste. The assembly loop visits every Gauss
point of every element, every Newton iteration, of every increment of every
phase. An indirect call there is not a stylistic cost: it defeats the
branch predictor's ability to specialise on the element type, and it blocks
the vectorisation the SoA layout is there to enable. The engine runs the
assembly in two phases — parallel computation, sequential scatter — and that
split is only sound because the per-element work has no shared mutable state
and no indirect dispatch through a shared pointer.

**This is a constraint on the code, not a style preference.** A new constitutive
model is a new enum value, a new case in the registry, and a new `switch` arm
— never a new subclass.

### The consistent tangent

A second consequence of the same discipline is the tangent modes in
`material_model.hpp`: `kNone`, `kContinuum` (the fast path) and `kConsistent`
(the numerically consistent / algorithmic tangent).

The consistent tangent is computed by a three-run forward difference
(Pérez-Foguet, CMAME 189 (2000) 277–296 and 190 (2001) 4627–4647) rather
than analytically for every model — the price of supporting ten constitutive
models against one another without ten hand-derived tangent implementations.
The hybrid strategy is deliberate: an increment starts on the continuum tangent
and is retried with the consistent tangent when the first attempt fails.

---

## 3. The linear solver: one backend, chosen at link time

`kernel/linsolve` builds **exactly one** of `select_eigen.cpp` XOR
`select_pardiso.cpp`. There is no `#ifdef` in the solver code that asks which
backend it is running on. The backend is a link-time fact, and
`backend_name()` reports the one that was actually linked — never the one the
build merely wanted, because a published result has to be traceable to the
solver that produced it.

Eigen's `SimplicialLDLT` and `SparseLU` are always built, so a tree with
neither MKL nor PARDISO still solves.

The linear solve reaches the solver as an **injected callback** (`LinearSolve`),
not as a call into a global. That is what lets the same assembly code run
against either backend, and what lets a test substitute its own solver without
the engine knowing.

### No OpenMP

There is no OpenMP in this tree, and that is a measured decision rather than an
omission. For the Hardening Soil undrained case near failure, the profile was:

| Stage | Share of run time |
|---|---|
| Tangent assembly | 48% |
| Residual assembly | 48% |
| **Linear solve** | **3%** |

A 2.4× PARDISO penalty buys almost nothing when the solve is 3% of the work.
The parallelism that does pay is in the assembly, and it is a custom
`katai::math::thread_pool` with a deterministic two-phase structure (parallel
compute, sequential scatter) so that **the same model produces the same
numbers on any number of threads**. Determinism is not traded for speed
anywhere in this engine.

---

## 4. The input contract, and what a refusal means

`validate_project` is mandatory and cannot be bypassed. `Job::run()` executes
the input contract itself, so a consumer of the published facade cannot solve
an invalid project even by accident.

The rule the whole system is built around:

> An input may be used differently from the way it was written, but never in
> silence.

Two vocabularies report on this, and they are different things:

- **79 stable diagnostic codes** (`K2D-*`, six families: A analysis/numerics,
  G geometry, M material, S schema/phase, I input/structure) describe what a run
  *did* that the file does not literally say — a line clipped to the soil, a
  fallback taken, an object refused. Severity `warning` continues; `refusal`
  stops.
- **Validation issues** (`Issue`) describe a violation of the input contract,
  each at one field path (`materials[2].Rf`).

The two are not interchangeable and are not merged. The validator runs before a
mesh exists, so it cannot see anything decided against the mesh — which is
exactly what the diagnostics list is for. `check_silent_drop` fails the build
when a selection drops an input without saying so.

### The material is resolved by name, and refused — not substituted

A material is looked up by **name**. When the name does not resolve, the run
is **refused** with the code and the field path. It is not silently replaced by
a default, and it is not matched loosely. The reason is specific: a
substitution changes the answer while the file still says something else, and
a reader of the report would have no way to know.

---

## 5. Verification is machine-enforced, not asserted

`scripts/check_references.py` (ctest entry `test_reference_registry`) requires
every test that checks a number to carry a `// verify: KV-XXX-NNN` block
naming the oracle, the source, the locator, the quantity, the expected value
and the band. The oracle must be one of `closed_form`, `independent_path`,
`external_code` or `published_benchmark`.

Self-consistency does not count as verification. A test that compares the
engine against the engine proves nothing, and the gate will not accept it.

The record this produces is `docs/validation/verification-matrix.md` and
`references.bib`. There are 136 declared cases: 94 closed-form, 31
independent-path, 11 published-benchmark.

The registry has a **ratchet**: `scripts/language_baseline.json`'s sibling
`UNDECLARED_AT_ADOPTION` names the 102 files that predate the policy. That
list may only shrink. A file added to it is a decision someone has to make
explicitly, and the gate fails if it grows.

---

## 6. The deferred namespace rename — and the conditions for lifting it

New code is born in the convention namespace: `katai::model`, `katai::io`,
`katai::jobs`, `katai::analysis`, `katai::materials`.

**Exception.** The following keep their historical `katai::app` spelling:

| Header | Historic namespace | Conventional would be |
|---|---|---|
| `kernel/io/include/katai/io/results_io.hpp` | `katai::app` | `katai::io` |
| `kernel/jobs/include/katai/jobs/driver.hpp` (and the types it wraps) | `katai::app` | `katai::jobs` |
| `kernel/jobs/include/katai/jobs/job.hpp` (the types it wraps) | `katai::app` | `katai::jobs` |

The reason for keeping the exception: **moving files and renaming namespaces
are separate steps in this repository, on purpose.** A rename that also moved
files would put two independent changes in one commit, and a bisect could not
tell which of them broke a consumer.

The rename is deferred, not cancelled. It should be lifted when **all** of the
following hold:

1. No header outside `kernel/io/` and `kernel/jobs/` spells `katai::app`.
2. The Python bindings, the CLI and the web app compile against the new
   spellings, and the `.res` round-trip test still passes byte for byte.
3. The `tests/test_api_surface.cpp` sufficiency test — which compiles the
   whole workflow against the facade header alone — passes with the new names.
4. The rename is done as its own commit, with no file moves in it.

Until then, the exception is recorded here and the headers say so where a
reader would otherwise wonder.

---

## 7. File formats

- **`.k2d`** — the project file. JSON, version **29**. Every version bump marks
  an input that an older build would have dropped in silence, and an older
  build refuses a newer file rather than misreading it.
- **`.res`** — the results file. Binary, version **12**, deliberately not JSON:
  a double costs ~20 bytes as JSON text and must be re-parsed, and a 100k-node
  ten-phase run would be a few hundred megabytes of text. The layout is
  `"K2DR"`, u32 version, u64 model hash, the mesh stored once, then per phase
  the scalars, the nodal fields and the structural force diagrams.

The `model_hash` is FNV-1a over the **canonical** project JSON, so results are
rejected as stale when the model no longer matches them — even if the user
reformatted the file by hand. Every front end computes it the same way
(`fnv1a64(project_to_json(project))`), which is what lets a `.res` written by
the CLI be read by the Python package.

`docs/k2d-format.md` is the prose reference, `docs/k2d.schema.json` is the
machine-readable one, and `scripts/check_k2d_spec.py` (ctest entry
`check_k2d_spec`) fails the build when the writer, the reader, the prose
inventory, the JSON schema and the version constants disagree about any key.
It reports **224 locked keys**.

### `explicit_mesh`

A `.k2d` may carry its own mesh (`explicit_mesh`). When present and
self-consistent, the solver uses it instead of generating one, so the file
describes the discretization it was checked on.

This is the seam where the two meshing worlds meet, and it is worth being
blunt about: **the kernel's C++ mesher and the web app's Python gmsh mesher
are not the same mesher.** The web app generates a mesh with gmsh +
OpenCASCADE and stores it as `explicit_mesh`; the CLI, the verification
corpus and the test suite use the kernel's own constrained-Delaunay/Ruppert
mesher. A mesh the user can see in the browser is therefore not necessarily
the mesh the answer was computed on.

That is a known defect, not a design. It is scheduled for the roadmap's
Phase E2, and until it is fixed, the honest statement is the one in this
paragraph rather than the one a user would prefer.

---

## 8. What is verified, and what is not

The verification record is 136 cases across eleven classes (STR 33, CST 26,
FND 18, NUM 16, FLW 14, CON 9, SLP 5, GEO 4, DYN 4, DIA 3, EXC 3, LIQ 1).

Separately, `tests/verification/plaxis/registry.json` holds a PLAXIS parity
registry: 30 cases (26 Taylor-Muir plus four Schweiger 2002 Berlin). It is a
**parity** record, not a **verification** record, and the two answer different
questions — a case can agree with PLAXIS to 0.07% and still be rejected as
verification because tri6 elements shift a drained factor of safety by +4.3%
away from the closed form. The registry therefore carries two verdict columns,
`parity_vs_plaxis` and `converged_vs_closed_form`, and a case is not allowed
to lose the first by failing the second.

Current state: **PASS 3, FAIL 1, BLOCKED 24, TIMEOUT 2.**

---

## 9. The gates

Every rule in this document that can be checked by a machine is checked by a
machine. The source gates are registered as ctest entries, so they run with
the suite rather than beside it:

| Gate | What it enforces |
|---|---|
| `check_language` | every comment, identifier and diagnostic message in the source tree is English |
| `check_architecture` | the layer contract: dependencies downward, no cycles, no physics above the engine, front ends on the facade alone |
| `test_reference_registry` | every number-checking test declares its oracle; the ratchet never grows |
| `check_k2d_spec` | writer, reader, prose spec, JSON schema and version constants agree |
| `check_silent_drop` | no selection discards an input without reporting it |
| `plaxis_harness_smoke` | the parity harness itself works |

A rule that is only in a document is a rule nobody has to keep. Every claim
above that names a gate is checkable; the ones that do not name one are stated
as scope, not as contract.

---

## 10. Scope, stated rather than implied

- This is 2D by design. There is no 3D.
- Committed Gauss states are not stored in a `.res`. Restored results are for
  viewing and post-processing; continuing a staged run re-calculates.
- Cancellation is phase-granular. Iteration-granular cancellation needs a hook
  through the nonlinear solver's step loop and is not there yet.
- The unsatated zone's retention curve (van Genuchten) and relative
  permeability (Mualem) are implemented and reachable from the file, but the
  verification record covers the **saturated limit** of that formulation.
- The liquefaction **triggering** side (TBDY 2018 Annex 16B) is implemented.
  The full cyclic model is not.
- The web app is a separate, in-development track over the same kernel.

---

## See also

- `docs/k2d-format.md` — the `.k2d` and `.res` formats, field by field.
- `docs/k2d.schema.json` — the machine-readable project schema.
- `docs/diagnostics.md` — the 79 `K2D-*` diagnostic codes.
- `docs/validation/verification-matrix.md` — the verification record.
- `docs/superpowers/plans/2026-11-05-plaxis-parity.md` — the parity plan.
- `docs/superpowers/plans/2026-11-06-plaxis-completeness-roadmap.md` — the
  completeness roadmap this tree is working through.
