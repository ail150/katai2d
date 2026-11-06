#!/usr/bin/env python3
"""Tutorial Manual Lesson 2: drained and undrained stability of an embankment.

Plane strain, Hardening Soil. A 4 m embankment on a 6 m clay layer. A Safety
(phi-c reduction) phase gives the factor of safety: drained (TM 1.8) and
undrained (TM 1.4).

The .k2d phase chain is strictly linear (each phase continues the previous; there
is no per-phase "start from"), so the TM's two branches are built as TWO projects:
  drained:   Initial K0 -> Plastic (embankment) -> Safety
  undrained: same, with the clay material set to Undrained (A)

Parameters (TM pp. 40-51): embankment HS gamma 16, E50=Eoed 15e3, Eur 45e3,
m 0.5, c' 3, phi 30; clay HS gamma 16/13, E50 5600, Eoed 5000, Eur 20e3, m 1.0,
c' 10, phi 25, OCR 1.2. Safety: incremental Msf = 0.1, reset displacements.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

CLAY_DR = {
    "name": "Clay", "model": 2, "drainage": 0, "color": [0.72, 0.64, 0.48],
    # TM Table 2-1: clay gamma_unsat = gamma_sat = 13 kN/m3 (embankment 16/16).
    "gamma_unsat": 13, "gamma_sat": 13, "e_init": 1.0,
    "E50ref": 5600, "Eoedref": 5000, "Eurref": 20000, "m": 1.0, "p_ref": 100,
    "nu_ur": 0.2, "Rf": 0.9, "c": 10, "phi": 25, "psi": 0,
    "k0nc_auto": True, "oc_mode": 1, "OCR": 1.2, "kx": 1e-3, "ky": 1e-3,
}
EMB = {
    "name": "Embankment", "model": 2, "drainage": 0, "color": [0.85, 0.75, 0.5],
    "gamma_unsat": 16, "gamma_sat": 16, "e_init": 0.5,
    "E50ref": 15000, "Eoedref": 15000, "Eurref": 45000, "m": 0.5, "p_ref": 100,
    "nu_ur": 0.2, "Rf": 0.9, "c": 3, "phi": 30, "psi": 0,
    "k0nc_auto": True, "kx": 1, "ky": 1,
}
CLAY_POLY = {
    "name": "Clay layer", "material": 0, "coarseness": 1,
    "x": [0, 50, 50, 0], "y": [-6, -6, 0, 0],
    "edge_bc": [4, 2, 0, 2], "edge_flow": [0, 0, 0, 0],
    "edge_head": [0, 0, 0, 0], "edge_flux": [0, 0, 0, 0],
}
EMB_POLY = {
    "name": "Embankment body", "material": 1, "coarseness": 1,
    "x": [14, 22, 24, 36], "y": [0, 4, 4, 0],
    "edge_bc": [0, 0, 0, 0], "edge_flow": [0, 0, 0, 0],
    "edge_head": [0, 0, 0, 0], "edge_flux": [0, 0, 0, 0],
}
MESH = {"elem_size": 2.0, "order": 15, "auto_refine": False, "grading": 0.15, "corner_refine": True}


def _phase(name, type_, poly, steps=50, **extra):
    base = {
        "name": name, "type": type_, "duration": 1, "steps": steps, "design": 0,
        "seiswave": 0, "seisamp": 1, "seisfreq": 2, "damp": 0.05, "rayf1": 1, "rayf2": 8,
        "poly": poly, "struct": [], "load": [], "disp": [], "hydro": [],
    }
    base.update(extra)
    return base


def build(undrained: bool):
    clay = dict(CLAY_DR)
    if undrained:
        clay["drainage"] = 1  # Undrained (A)
    return {
        "katai2d": 29, "name": f"TM L2 - embankment ({'undrained' if undrained else 'drained'})",
        "axisymmetric": False, "initial_procedure": 0,
        "x_min": 0, "x_max": 50, "y_min": -6, "y_max": 4,
        "has_water": True, "wx": [0, 50], "wy": [0, 0], "mesh": MESH,
        "materials": [clay, EMB], "plates": [], "anchors": [], "geogrids": [], "embedded": [],
        "polygons": [CLAY_POLY, EMB_POLY], "structs": [], "loads": [], "disps": [], "hydros": [],
        "initial": _phase("Initial phase", 0, [1, 0], steps=25),
        "phases": [
            _phase("Build embankment", 0, [1, 1]),
            _phase("Safety", 1, [1, 1], resetdisp=True),
        ],
    }


def main():
    (HERE / "l2_drained.k2d").write_text(json.dumps(build(False)))
    (HERE / "l2_undrained.k2d").write_text(json.dumps(build(True)))
    print("wrote l2_drained.k2d, l2_undrained.k2d")


if __name__ == "__main__":
    main()
