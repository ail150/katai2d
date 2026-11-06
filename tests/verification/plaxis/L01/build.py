#!/usr/bin/env python3
"""Build the Tutorial Manual Lesson 1 models (circular footing on sand).

Two cases, both axisymmetric, sand = Mohr-Coulomb drained:
  A (rigid)    : line prescribed displacement uy = -0.05 m on (0,4)-(1,4).
  B (flexible) : footing plate + line load qy = -188 kN/m^2 on (0,4)-(1,4).

Parameters (TM pp. 11-35): sand E'=13e3, nu=0.3, c'=1, phi=30, psi=0,
gamma 17/20, 4 m layer, model radius 5 m, head 2.0 m. Plate EA=5e6, EI=8500.

The object model follows docs/k2d.schema.json (format v29):
  - plates[] are MATERIALS (EA, EI, w, nu); geometry is a structs[] entry with
    kind=0 that references the plate material by index.
  - phase activity arrays (poly/struct/load/disp) are 1-based indices into the
    respective top-level arrays; an entry of 0 is a placeholder (nothing).

These two files are byte-compatible with web/examples/tutorial1-{rigid,flexible}
but authored here so the verification corpus owns its inputs, and pinned to a
mesh that matches PLAXIS 'Medium' element counts for a fair comparison.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

SAND = {
    "name": "Sand", "model": 1, "drainage": 0, "color": [0.91, 0.78, 0.48],
    "gamma_unsat": 17, "gamma_sat": 20, "e_init": 0.5,
    "E": 13000, "nu": 0.3, "c": 1, "phi": 30, "psi": 0, "kx": 1, "ky": 1,
}
SAND_POLY = {
    "name": "Sand layer", "material": 0, "coarseness": 1,
    "x": [0, 5, 5, 0], "y": [0, 0, 4, 4],
    "edge_bc": [4, 2, 0, 2], "edge_flow": [0, 0, 0, 0],
    "edge_head": [0, 0, 0, 0], "edge_flux": [0, 0, 0, 0],
}
MESH = {"elem_size": 1, "order": 15, "auto_refine": False, "grading": 0.3, "corner_refine": True}


def _phase(name, poly, struct, load, disp, steps=25):
    return {
        "name": name, "type": 0, "duration": 1, "steps": steps, "design": 0,
        "seiswave": 0, "seisamp": 1, "seisfreq": 2, "damp": 0.05, "rayf1": 1, "rayf2": 8,
        "poly": poly, "struct": struct, "load": load, "disp": disp, "hydro": [],
    }


def build_rigid():
    return {
        "katai2d": 29, "name": "TM L1 - rigid footing", "axisymmetric": True,
        "initial_procedure": 0, "x_min": 0, "x_max": 5, "y_min": 0, "y_max": 4,
        "has_water": True, "wx": [0, 5], "wy": [2, 2], "mesh": MESH,
        "materials": [SAND], "plates": [], "anchors": [], "geogrids": [], "embedded": [],
        "polygons": [SAND_POLY], "structs": [], "loads": [],
        "disps": [{
            "name": "Rigid footing indentation", "x1": 0, "y1": 4, "x2": 1, "y2": 4,
            "set_ux": True, "ux": 0, "set_uy": True, "uy": -0.05, "coarseness": 0.25,
        }],
        "hydros": [],
        "initial": _phase("Initial phase", [1], [], [], [0]),
        "phases": [_phase("Indentation", [1], [], [], [1])],
    }


def build_flexible():
    return {
        "katai2d": 29, "name": "TM L1 - flexible footing", "axisymmetric": True,
        "initial_procedure": 0, "x_min": 0, "x_max": 5, "y_min": 0, "y_max": 4,
        "has_water": True, "wx": [0, 5], "wy": [2, 2], "mesh": MESH,
        "materials": [SAND],
        "plates": [{
            "name": "Footing", "color": [0.2, 0.42, 0.8], "elastoplastic": False,
            "EA": 5000000, "EI": 8500, "w": 0, "nu": 0, "Mp": 0, "Np": 0, "punch": False,
        }],
        "anchors": [], "geogrids": [], "embedded": [],
        "polygons": [SAND_POLY],
        "structs": [{
            "kind": 0, "name": "Footing plate", "x1": 0, "y1": 4, "x2": 1, "y2": 4,
            "material": 0, "coarseness": 0.25,
        }],
        "loads": [{
            "kind": 1, "name": "Footing load", "x1": 0, "y1": 4, "x2": 1, "y2": 4,
            "qx1": 0, "qy1": -188, "qx2": 0, "qy2": -188, "coarseness": 0.25,
        }],
        "disps": [], "hydros": [],
        "initial": _phase("Initial phase", [1], [0], [0], []),
        "phases": [_phase("Loading", [1], [1], [1], [])],
    }


def main():
    (HERE / "l1a_rigid.k2d").write_text(json.dumps(build_rigid()))
    (HERE / "l1b_flexible.k2d").write_text(json.dumps(build_flexible()))
    print("wrote l1a_rigid.k2d, l1b_flexible.k2d")


if __name__ == "__main__":
    main()
