#!/usr/bin/env python3
"""Tutorial Manual Lesson 9 (reduced): consolidation to a minimum excess pore pressure.

The full TM L9 is a Soft Soil road embankment with drains and several
consolidation stages (and Updated-mesh variants). The verifiable SCALAR this
build targets is TM p. 158: after the consolidation stage that ends on a minimum
excess pore pressure of 1 kPa, the maximum excess pore pressure is at that level.

Model: a surcharge on a soft clay layer, undrained loading, then a consolidation
phase with cstop=1 (minimum excess pore pressure) and cminp=1 kPa. We read the
maximum |excess pore pressure| at the end of the consolidation phase; it must
have fallen to the 1 kPa stop level. This is the consolidation stop-criterion
mechanism (the same one verified by KV-CON-003), applied through the embankment
loading path.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

# A soft clay, Soft Soil model, Undrained (A) so a load builds excess pore pressure.
CLAY = {
    "name": "Soft clay", "model": 4, "drainage": 1, "color": [0.6, 0.6, 0.5],
    "gamma_unsat": 15, "gamma_sat": 15, "e_init": 1.0,
    "lamstar": 0.05, "kapstar": 0.01, "nu_ur": 0.15,
    "c": 1, "phi": 25, "psi": 0, "k0nc_auto": True,
    "kx": 1e-3, "ky": 1e-3,
}
CLAY_POLY = {
    "name": "Clay layer", "material": 0, "coarseness": 1,
    "x": [0, 20, 20, 0], "y": [0, 0, 6, 6],
    # top drained (seepage), base + sides closed to flow via edge_flow handled by BCs;
    # mechanical: base fixed, sides roller, top free.
    "edge_bc": [4, 2, 0, 2], "edge_flow": [0, 0, 0, 0],
    "edge_head": [0, 0, 0, 0], "edge_flux": [0, 0, 0, 0],
}
# A strip surcharge on the surface.
LOAD = {
    "kind": 1, "name": "Surcharge", "x1": 0, "y1": 6, "x2": 8, "y2": 6,
    "qx1": 0, "qy1": -40, "qx2": 0, "qy2": -40, "coarseness": 0.5,
}
MESH = {"elem_size": 1.5, "order": 6, "auto_refine": False, "grading": 0.15, "corner_refine": True}


def _phase(name, type_, poly, load, steps=25, **extra):
    base = {
        "name": name, "type": type_, "duration": 1, "steps": steps, "design": 0,
        "seiswave": 0, "seisamp": 1, "seisfreq": 2, "damp": 0.05, "rayf1": 1, "rayf2": 8,
        "poly": poly, "struct": [], "load": load, "disp": [], "hydro": [],
    }
    base.update(extra)
    return base


def build():
    return {
        "katai2d": 29, "name": "TM L9 (reduced) - consolidation to min pore pressure",
        "axisymmetric": False, "initial_procedure": 0,
        "x_min": 0, "x_max": 20, "y_min": 0, "y_max": 6,
        "has_water": True, "wx": [0, 20], "wy": [6, 6], "mesh": MESH,
        "materials": [CLAY], "plates": [], "anchors": [], "geogrids": [], "embedded": [],
        "polygons": [CLAY_POLY], "structs": [], "loads": [LOAD], "disps": [], "hydros": [],
        "initial": _phase("Initial phase", 0, [1], [0]),
        "phases": [
            # Ph1: apply the surcharge undrained (fast loading -> excess pore pressure).
            _phase("Apply surcharge", 0, [1], [1]),
            # Ph2: consolidate until the maximum excess pore pressure falls to 1 kPa.
            _phase("Consolidate", 2, [1], [1], cstop=1, cminp=1.0, cmaxstep=1000),
        ],
    }


def main():
    (HERE / "l9_consol.k2d").write_text(json.dumps(build()))
    print("wrote l9_consol.k2d")


if __name__ == "__main__":
    main()
