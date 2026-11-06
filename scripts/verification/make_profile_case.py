#!/usr/bin/env python3
"""Write a short profiling variant of a lesson model (plaxis-parity Phase 11).

Keeps the initial phase and the FIRST staged phase only, and applies a fraction
`--mstage` of that phase's staged change, so the phase finishes after a few load
increments and the solver's KATAI_NL_PROFILE breakdown (tangent / residual /
linear solve time) is printed. The breakdown fractions -- not the absolute time --
are what tell us where an increment's cost goes.

Usage:
    python make_profile_case.py --lesson L02 --builder-arg undrained --mstage 0.1 --out /tmp/x.k2d
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
    ap.add_argument("--builder-arg", default=None, help="'undrained' -> build(True) for L02")
    ap.add_argument("--mstage", type=float, default=0.1)
    ap.add_argument("--loadsteps", type=int, default=0)
    ap.add_argument("--substol", type=float, default=0.0,
                    help="HS constitutive substep tolerance for the staged phase (0 = engine default)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    bp = REPO / "tests" / "verification" / "plaxis" / a.lesson / "build.py"
    spec = importlib.util.spec_from_file_location("b", bp)
    b = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b)
    m = b.build(a.builder_arg == "undrained") if a.builder_arg else b.build()
    m["phases"] = m["phases"][:1]
    m["phases"][0]["mstage"] = a.mstage
    if a.loadsteps:
        m["phases"][0]["loadsteps"] = a.loadsteps
    if a.substol > 0:
        m["phases"][0]["substol"] = a.substol
    Path(a.out).write_text(json.dumps(m))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
