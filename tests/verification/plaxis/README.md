# PLAXIS 2D parity verification corpus

This tree holds the machine-readable reference values used to verify the KATAI
engine against the **PLAXIS 2D Tutorial Manual** (19 lessons) and the **Schweiger
(2002) "Benchmarking in Geotechnics 1"** Berlin-sand deep excavation.

It is the data half of Phase 0 of
`docs/superpowers/plans/2026-11-05-plaxis-parity.md`. The tooling that reads it
lives in `scripts/verification/`.

## Provenance and licensing

The PLAXIS PDFs are **not** redistributable and are **not** committed. They live
outside the repository at `../plaxis2DSources/` on the author's machine. What is
committed here is only *derived numeric data*: reference values typed from the
manual text, and curve samples digitised or vector-extracted from the figures,
each tagged with the source document and page so a reader with the originals can
re-check it. No manual prose or figure image is reproduced.

## Layout

```
registry.json              one record per verification case (scalars + curve refs)
L01/ … L19/                per-lesson reference curves (CSV) + build scripts (later phases)
benchmark-berlin/          Schweiger 2002 reference curves (CSV)
```

## registry.json record schema

Each entry in `cases` is an object:

| field | meaning |
|---|---|
| `id` | KV-PLX-… identifier, also the ctest/report key |
| `lesson` | tutorial lesson number, or `"BM"` for the benchmark |
| `title` | short human label |
| `source` | `"TM"`, `"RM"`, `"SM"`, `"BM"` |
| `pages` | page number(s) in that document |
| `kind` | `"scalar"`, `"curve"`, or `"qualitative"` |
| `quantity` | what is compared, with units |
| `expected` | scalar value (for `scalar`), or `null` |
| `ref_csv` | path to the reference curve CSV (for `curve`), or `null` |
| `ref_uncertainty` | `"exact"` (typed from text), `"approx"` (manual says "about…"), or `"digitised"` |
| `u_dig` | digitising uncertainty as a fraction of the axis range, when `ref_uncertainty == "digitised"` |
| `tolerance` | pass band as a fraction (default 0.02) |
| `features` | engine features the case needs (for gating) |
| `status` | `"ready"`, `"blocked"`, or `"needs_ui"` — current expectation, refined as phases land |
| `notes` | provenance / interpretation notes |

## Pass criterion (plan decision D2)

For a scalar: relative error `|katai − ref| / |ref| < tolerance`.

For a curve, with the KATAI result linearly interpolated onto the reference
abscissae `x_i`:

```
e_i   = |y_katai(x_i) − y_ref(x_i)| / max(|y_ref(x_i)|, floor)
floor = 0.10 · max_j |y_ref(x_j)|
pass  = max_i e_i < tolerance
```

The 10 %-of-peak floor keeps points that sit near zero (e.g. the toe of a wall
deflection curve) from making a relative error undefined.

When `ref_uncertainty == "digitised"` and `u_dig` approaches `tolerance`, the
result is reported `UNDECIDABLE`, never `PASS` — a 2 % claim cannot be defended
on data read from a raster figure to worse than 2 %.
