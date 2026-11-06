#!/usr/bin/env python3
"""Tutorial Manual Lesson 7 (reduced): anchor force equals prestress.

The full TM L7 is a 3-layer HS tie-back wall with grout bodies and steady flow.
The verifiable SCALAR this build targets is TM p. 137: when a prestressed
node-to-node anchor is activated, its force equals the prestress (500 kN) in that
phase. This is a prestress-mechanism check, not the full excavation, so it runs
in a Plastic phase without Safety (fast and deterministic).

Model: a 16 m sheet-pile wall in a single drained HS sand, a 10 m wide pit (half
not used; full wall). An excavation to -3 m, then a node-to-node anchor at the
wall head prestressed to 500 kN with 2.5 m out-of-plane spacing (so 200 kN/m).
We read the anchor's axial force in the activation phase.

This is a focused parity check; the full L7 wall deflection / moment curves need
the complete multi-phase model and are tracked separately (and gated by the HS
performance work, Phase 11).
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

SAND = {
    "name": "Sand", "model": 2, "drainage": 0, "color": [0.9, 0.8, 0.5],
    "gamma_unsat": 17, "gamma_sat": 20, "e_init": 0.5,
    "E50ref": 30000, "Eoedref": 30000, "Eurref": 90000, "m": 0.5, "p_ref": 100,
    "nu_ur": 0.2, "Rf": 0.9, "c": 1, "phi": 34, "psi": 4,
    "k0nc_auto": True, "kx": 1, "ky": 1,
}
WALL = {
    "name": "Wall", "color": [0.2, 0.42, 0.8], "elastoplastic": False,
    "EA": 12_000_000, "EI": 120_000, "w": 8.3, "nu": 0.15, "Mp": 0, "Np": 0, "punch": True,
}
# Node-to-node anchor material: EA per anchor, out-of-plane spacing Lspacing,
# and the lock-off prestress force (TM row 1 = 500 kN).
ANCHOR = {
    "name": "Ground anchor", "color": [0.5, 0.3, 0.7], "elastoplastic": False,
    "EA": 500_000, "Lspacing": 2.5, "Fmax_tens": 0, "Fmax_comp": 0, "prestress": 500.0,
}

SOIL_POLY = {
    "name": "Sand", "material": 0, "coarseness": 1,
    "x": [0, 40, 40, 0], "y": [0, 0, 30, 30],
    "edge_bc": [4, 2, 0, 2], "edge_flow": [0, 0, 0, 0],
    "edge_head": [0, 0, 0, 0], "edge_flux": [0, 0, 0, 0],
}
# Wall from (20,30) down to (20,14): a 16 m sheet pile. kind 0 = plate.
WALL_STRUCT = {
    "kind": 0, "name": "Sheet pile wall", "x1": 20, "y1": 30, "x2": 20, "y2": 14,
    "material": 0, "coarseness": 0.25, "iface_pos": True, "iface_neg": True,
}
# Node-to-node anchor from the wall head (20,27) to a dead point in the ground
# behind the wall (9,21): kind 1 = anchor.
ANCHOR_STRUCT = {
    "kind": 1, "name": "Anchor row 1", "x1": 20, "y1": 27, "x2": 9, "y2": 21,
    "material": 0, "coarseness": 0.25,
}
MESH = {"elem_size": 2.0, "order": 15, "auto_refine": False, "grading": 0.15, "corner_refine": True}


def _phase(name, type_, poly, struct, steps=50, **extra):
    base = {
        "name": name, "type": type_, "duration": 1, "steps": steps, "design": 0,
        "seiswave": 0, "seisamp": 1, "seisfreq": 2, "damp": 0.05, "rayf1": 1, "rayf2": 8,
        "poly": poly, "struct": struct, "load": [], "disp": [], "hydro": [],
    }
    base.update(extra)
    return base


def build():
    return {
        "katai2d": 29, "name": "TM L7 (reduced) - anchor prestress", "axisymmetric": False,
        "initial_procedure": 0, "x_min": 0, "x_max": 40, "y_min": 0, "y_max": 30,
        "has_water": False, "wx": [], "wy": [], "mesh": MESH,
        "materials": [SAND], "plates": [WALL], "anchors": [ANCHOR], "geogrids": [], "embedded": [],
        "polygons": [SOIL_POLY],
        "structs": [WALL_STRUCT, ANCHOR_STRUCT],
        "loads": [], "disps": [], "hydros": [],
        # Initial: soil only (wall/anchor off).
        "initial": _phase("Initial phase", 0, [1], [0, 0], steps=25),
        "phases": [
            # Ph1: install the wall (wished in place).
            _phase("Install wall", 0, [1], [1, 0]),
            # Ph2: activate the anchor; its lock-off prestress (500 kN on the
            # material) is applied on activation.
            _phase("Prestress anchor", 0, [1], [1, 1]),
        ],
    }


def main():
    (HERE / "l7_anchor.k2d").write_text(json.dumps(build()))
    print("wrote l7_anchor.k2d")


if __name__ == "__main__":
    main()
