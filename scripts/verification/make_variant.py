#!/usr/bin/env python3
"""Write a numerics variant of a lesson model (plaxis-parity Phase 11).

The physics is untouched; only discretisation / numerical controls change, so the
variants can be compared against each other to show whether an answer depends on
them (the project's own rule for accepting a faster setting).

  --order 6|15          element order
  --elem-size X         target element size [m]
  --substol X           HS constitutive substep tolerance on EVERY staged phase
  --tol X               tolerated equilibrium error on every staged phase

Usage:
    python make_variant.py --lesson L02 --builder-arg undrained --order 6 --substol 1e-4 --out x.k2d
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", required=True)
    ap.add_argument("--builder-arg", default=None)
    ap.add_argument("--order", type=int, default=0)
    ap.add_argument("--elem-size", type=float, default=0.0)
    ap.add_argument("--substol", type=float, default=0.0)
    ap.add_argument("--tol", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    bp = REPO / "tests" / "verification" / "plaxis" / a.lesson / "build.py"
    spec = importlib.util.spec_from_file_location("b", bp)
    b = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b)
    # --builder-arg undrained|drained -> build(True|False) for lessons whose build()
    # takes the drainage switch (L02); omitted -> build() for the others.
    m = b.build(a.builder_arg == "undrained") if a.builder_arg else b.build()
    if a.order:
        m["mesh"]["order"] = a.order
    if a.elem_size > 0:
        m["mesh"]["elem_size"] = a.elem_size
    for ph in m.get("phases", []):
        if a.substol > 0:
            ph["substol"] = a.substol
        if a.tol > 0:
            ph["tol"] = a.tol
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(m))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
