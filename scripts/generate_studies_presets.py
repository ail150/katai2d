import json
from pathlib import Path
import math

repo_root = Path(__file__).resolve().parent.parent
studies_dir = repo_root / "tests" / "studies"
studies_dir.mkdir(parents=True, exist_ok=True)

def base_material(name, model=1, drainage=0, E=1e4, nu=0.3, c=1.0, phi=30.0, psi=0.0, gamma=18.0, gamma_sat=20.0, kx=1.0, ky=1.0):
    return {
        "name": name,
        "model": model,
        "drainage": drainage,
        "color": [0.85, 0.78, 0.55],
        "gamma_unsat": gamma,
        "gamma_sat": gamma_sat,
        "e_init": 0.5,
        "E": E,
        "nu": nu,
        "c": c,
        "phi": phi,
        "psi": psi,
        "E_inc": 0,
        "c_inc": 0,
        "y_ref": 0,
        "tension_cutoff": True,
        "dilatancy_cutoff": False,
        "e_max": 1,
        "tensile_strength": 0,
        "E50ref": 30000,
        "Eoedref": 30000,
        "Eurref": 90000,
        "m": 0.5,
        "nu_ur": 0.2,
        "p_ref": 100,
        "Rf": 0.9,
        "k0nc_auto": True,
        "k0nc": 0.5,
        "G0ref": 120000,
        "gamma07": 0.00015,
        "lamstar": 0.1,
        "kapstar": 0.02,
        "mustar": 0.005,
        "kx": kx,
        "ky": ky,
        "und_mode": 0,
        "nu_u": 0.495,
        "skempton_B": 0,
        "gw_ga": 14.5,
        "gw_gn": 2.68,
        "gw_gl": 0.5,
        "gw_Sres": 0.1,
        "rinter_rigid": True,
        "Rinter": 1,
        "k0_auto": True,
        "k0": 0.5,
        "oc_mode": 0,
        "OCR": 1,
        "POP": 0
    }

def empty_initial(name="Initial phase", ptype=0):
    return {
        "name": name,
        "type": ptype,
        "duration": 1,
        "steps": 25,
        "design": 0,
        "seiswave": 0,
        "seisamp": 1,
        "seisfreq": 2,
        "damp": 0.05,
        "rayf1": 1,
        "rayf2": 8,
        "seisff": 0,
        "dynnl": 0,
        "seiscb": 0,
        "ec8on": 0,
        "ec8agr": 0.2,
        "ec8gi": 1,
        "ec8gnd": 2,
        "ec8typ": 0,
        "tbdyss": 1,
        "tbdys1": 0.4,
        "siteclass": 2,
        "poly": [],
        "struct": [],
        "load": [],
        "disp": [],
        "hydro": [],
        "water_override": False,
        "wx": [],
        "wy": []
    }

# 1. study-circular-footing.k2d
circ_mat = base_material("Sand", model=1, drainage=0, E=1.3e4, nu=0.3, c=1.0, phi=30.0, psi=0.0, gamma=17.0, gamma_sat=20.0)
circ_footing = {
    "katai2d": 29,
    "name": "Study: Circular footing on sand",
    "axisymmetric": True,
    "initial_procedure": 0,
    "x_min": 0, "x_max": 5, "y_min": 0, "y_max": 4,
    "has_water": True, "wx": [0, 5], "wy": [2, 2],
    "mesh": {"elem_size": 0.5, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [circ_mat],
    "plates": [], "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [{
        "name": "Sand foundation",
        "material": 0,
        "coarseness": 1,
        "x": [0, 5, 5, 0],
        "y": [0, 0, 4, 4],
        "edge_bc": [4, 2, 0, 2],
        "edge_flow": [], "edge_head": [], "edge_flux": []
    }],
    "structs": [], "loads": [],
    "disps": [{
        "name": "Footing settlement",
        "x1": 0, "y1": 4, "x2": 1, "y2": 4,
        "set_ux": False, "ux": 0,
        "set_uy": True, "uy": -0.05,
        "coarseness": 0.25
    }],
    "hydros": [],
    "initial": {**empty_initial("K0 equilibrium", 0), "poly": [1], "disp": [0]},
    "phases": [{
        **empty_initial("Prescribed settlement", 0),
        "poly": [1], "disp": [1], "duration": 1, "steps": 30
    }]
}
(studies_dir / "study-circular-footing.k2d").write_text(json.dumps(circ_footing, separators=(',', ':')), encoding="utf-8")

# 2. study-wall-benchmark.k2d (Cantilever sheet pile wall in cohesive clay)
wall_mat = base_material("Undrained clay", model=1, drainage=3, E=1.5e5, nu=0.4, c=35.0, phi=0.0, psi=0.0, gamma=17.0, gamma_sat=17.0)
wall_plate = {
    "name": "PU-12-240",
    "color": [0.2, 0.42, 0.8],
    "elastoplastic": False,
    "EA": 2.94e6, "EI": 45360, "w": 0.74, "nu": 0.28, "Mp": 0, "Np": 0
}
wall_bench = {
    "katai2d": 29,
    "name": "Study: Cantilever sheet pile in clay",
    "axisymmetric": False,
    "initial_procedure": 0,
    "x_min": 0, "x_max": 34, "y_min": 0, "y_max": 18.3,
    "has_water": False, "wx": [], "wy": [],
    "mesh": {"elem_size": 1.25, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [wall_mat],
    "plates": [wall_plate],
    "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [
        # Retained soil (x in [14, 34], y in [0, 18.3])
        {
            "name": "Retained side",
            "material": 0, "coarseness": 1,
            "x": [14, 34, 34, 14], "y": [0, 0, 18.3, 18.3],
            "edge_bc": [4, 2, 0, 0],
            "edge_flow": [], "edge_head": [], "edge_flux": []
        },
        # Deep front soil (x in [0, 14], y in [0, 11.8])
        {
            "name": "Sub-excavation front",
            "material": 0, "coarseness": 1,
            "x": [0, 14, 14, 0], "y": [0, 0, 11.8, 11.8],
            "edge_bc": [4, 0, 0, 2],
            "edge_flow": [], "edge_head": [], "edge_flux": []
        },
        # Excavation cut cluster (x in [0, 14], y in [11.8, 18.3])
        {
            "name": "Excavation cut",
            "material": 0, "coarseness": 0.75,
            "x": [0, 14, 14, 0], "y": [11.8, 11.8, 18.3, 18.3],
            "edge_bc": [0, 0, 0, 2],
            "edge_flow": [], "edge_head": [], "edge_flux": []
        }
    ],
    "structs": [
        {
            "kind": 0, "name": "Sheet pile wall",
            "x1": 14, "y1": 6, "x2": 14, "y2": 18.3,
            "material": 0, "iface_pos": True, "iface_neg": True, "iface_material": -1,
            "conn": 0, "flow_barrier": 0, "hyd_res": 0, "coarseness": 0.25
        }
    ],
    "loads": [], "disps": [], "hydros": [],
    "initial": {**empty_initial("K0 geostatic", 0), "poly": [1, 1, 1], "struct": [0]},
    "phases": [{
        **empty_initial("Excavate 6.5m", 0),
        "poly": [1, 1, 0], "struct": [1], "duration": 1, "steps": 25
    }]
}
(studies_dir / "study-wall-benchmark.k2d").write_text(json.dumps(wall_bench, separators=(',', ':')), encoding="utf-8")

# 2b. study-cantilever-sheetpile-interaction.k2d (With soil-structure interaction Rinter=0.67)
wall_mat_inter = {**wall_mat, "rinter_rigid": False, "Rinter": 0.67}
wall_bench_inter = {
    **wall_bench,
    "name": "Study: Cantilever sheet pile in clay (with Soil-Structure Interaction)",
    "materials": [wall_mat_inter],
}
(studies_dir / "study-cantilever-sheetpile-interaction.k2d").write_text(json.dumps(wall_bench_inter, separators=(',', ':')), encoding="utf-8")

# 3. study-slope-convergence.k2d
slope_mat = base_material("Slope soil", model=1, drainage=0, E=1.0e5, nu=0.3, c=3.0, phi=19.6, psi=0.0, gamma=20.2, gamma_sat=20.2)
slope_model = {
    "katai2d": 29,
    "name": "Study: Slope FoS convergence",
    "axisymmetric": False,
    "initial_procedure": 2,
    "x_min": 20, "x_max": 70, "y_min": 20, "y_max": 35,
    "has_water": False, "wx": [], "wy": [],
    "mesh": {"elem_size": 3.0, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [slope_mat],
    "plates": [], "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [{
        "name": "Slope",
        "material": 0, "coarseness": 1,
        "x": [20, 70, 70, 50, 30, 20],
        "y": [20, 20, 35, 35, 25, 25],
        "edge_bc": [4, 2, 0, 0, 0, 2],
        "edge_flow": [], "edge_head": [], "edge_flux": []
    }],
    "structs": [], "loads": [], "disps": [], "hydros": [],
    "initial": {**empty_initial("Safety analysis", 1), "poly": [1]},
    "phases": []
}
(studies_dir / "study-slope-convergence.k2d").write_text(json.dumps(slope_model, separators=(',', ':')), encoding="utf-8")

# 4. study-design-ec7.k2d
ec7_slope = {
    "katai2d": 29,
    "name": "Study: Eurocode 7 DA3 slope factoring",
    "axisymmetric": False,
    "initial_procedure": 2,
    "x_min": 20, "x_max": 70, "y_min": 20, "y_max": 35,
    "has_water": False, "wx": [], "wy": [],
    "mesh": {"elem_size": 3.0, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [slope_mat],
    "plates": [], "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [{
        "name": "Slope",
        "material": 0, "coarseness": 1,
        "x": [20, 70, 70, 50, 30, 20],
        "y": [20, 20, 35, 35, 25, 25],
        "edge_bc": [4, 2, 0, 0, 0, 2],
        "edge_flow": [], "edge_head": [], "edge_flux": []
    }],
    "structs": [], "loads": [], "disps": [], "hydros": [],
    "initial": {**empty_initial("EC7 DA3 Safety", 1), "design": 4, "poly": [1]},
    "phases": []
}
(studies_dir / "study-design-ec7.k2d").write_text(json.dumps(ec7_slope, separators=(',', ':')), encoding="utf-8")

# 5. study-foundation-sand.k2d
sand_block_mat = base_material("Demo sand", model=1, drainage=0, E=1.3e4, nu=0.3, c=5.0, phi=30.0, psi=0.0, gamma=17.0, gamma_sat=20.0)
sand_block = {
    "katai2d": 29,
    "name": "Study: Foundation strip load on sand",
    "axisymmetric": False,
    "initial_procedure": 1,
    "x_min": 0, "x_max": 20, "y_min": 0, "y_max": 10,
    "has_water": False, "wx": [], "wy": [],
    "mesh": {"elem_size": 1.0, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [sand_block_mat],
    "plates": [], "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [{
        "name": "Sand foundation",
        "material": 0, "coarseness": 1,
        "x": [0, 20, 20, 0], "y": [0, 0, 10, 10],
        "edge_bc": [4, 2, 0, 2],
        "edge_flow": [], "edge_head": [], "edge_flux": []
    }],
    "structs": [],
    "loads": [{
        "kind": 1, "name": "Strip load",
        "x1": 9, "y1": 10, "x2": 11, "y2": 10,
        "qx1": 0, "qy1": -100, "qx2": 0, "qy2": -100,
        "coarseness": 0.25
    }],
    "disps": [], "hydros": [],
    "initial": {**empty_initial("Gravity load", 0), "poly": [1], "load": [1]},
    "phases": []
}
(studies_dir / "study-foundation-sand.k2d").write_text(json.dumps(sand_block, separators=(',', ':')), encoding="utf-8")

# 6. study-lbb-undrained.k2d
lbb_mat = base_material("Saturated clay", model=1, drainage=1, E=2.0e4, nu=0.33, c=15.0, phi=22.0, psi=0.0, gamma=20.0, gamma_sat=20.0, kx=0.01, ky=0.01)
lbb_block = {
    "katai2d": 29,
    "name": "Study: Saturated block consolidation",
    "axisymmetric": False,
    "initial_procedure": 0,
    "x_min": 0, "x_max": 10, "y_min": 0, "y_max": 10,
    "has_water": True, "wx": [0, 10], "wy": [10, 10],
    "mesh": {"elem_size": 0.75, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [lbb_mat],
    "plates": [], "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [{
        "name": "Soil block",
        "material": 0, "coarseness": 1,
        "x": [0, 10, 10, 0], "y": [0, 0, 10, 10],
        "edge_bc": [4, 2, 0, 2],
        "edge_flow": [0, 0, 1, 0], # top edge is drained (FlowBCType::Head)
        "edge_head": [0, 0, 10, 0],
        "edge_flux": [0, 0, 0, 0]
    }],
    "structs": [],
    "loads": [{
        "kind": 1, "name": "Crest surcharge",
        "x1": 4, "y1": 10, "x2": 6, "y2": 10,
        "qx1": 0, "qy1": -100, "qx2": 0, "qy2": -100,
        "coarseness": 0.25
    }],
    "disps": [], "hydros": [],
    "initial": {**empty_initial("K0 geostatic", 0), "poly": [1], "load": [0]},
    "phases": [
        {
            **empty_initial("Undrained surcharge", 0),
            "poly": [1], "load": [1], "duration": 0.001, "steps": 5
        },
        {
            **empty_initial("Consolidation dissipation", 2),
            "poly": [1], "load": [1], "duration": 100, "steps": 30
        }
    ]
}
(studies_dir / "study-lbb-undrained.k2d").write_text(json.dumps(lbb_block, separators=(',', ':')), encoding="utf-8")

# 7. test-tunnel-ring.k2d (Circular tunnel excavation with plate lining)
tunnel_soil = base_material("Soft rock", model=1, drainage=0, E=2.5e5, nu=0.25, c=100.0, phi=25.0, psi=0.0, gamma=22.0, gamma_sat=22.0)
tunnel_plate = {
    "name": "Shotcrete lining",
    "color": [0.3, 0.5, 0.7],
    "elastoplastic": False,
    "EA": 7.0e6, "EI": 5.8e4, "w": 0.35, "nu": 0.2, "Mp": 0, "Np": 0
}
# Circular opening with 16 polygon chords at radius R=3m centered at (30, 30), domain 60x60m
xc, yc, R_tun = 30.0, 30.0, 3.0
n_pts = 16
angles = [2.0 * math.pi * i / n_pts for i in range(n_pts)]
tun_x = [round(xc + R_tun * math.cos(a), 3) for a in angles]
tun_y = [round(yc + R_tun * math.sin(a), 3) for a in angles]

tun_structs = []
for i in range(n_pts):
    j = (i + 1) % n_pts
    tun_structs.append({
        "kind": 0, "name": f"Lining seg {i+1}",
        "x1": tun_x[i], "y1": tun_y[i], "x2": tun_x[j], "y2": tun_y[j],
        "material": 0, "iface_pos": True, "iface_neg": False, "iface_material": -1,
        "conn": 0, "flow_barrier": 0, "hyd_res": 0, "coarseness": 0.25
    })

tunnel_model = {
    "katai2d": 29,
    "name": "Test: Circular tunnel and lining",
    "axisymmetric": False,
    "initial_procedure": 0,
    "x_min": 0, "x_max": 60, "y_min": 0, "y_max": 60,
    "has_water": False, "wx": [], "wy": [],
    "mesh": {"elem_size": 4.0, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [tunnel_soil],
    "plates": [tunnel_plate],
    "anchors": [], "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [
        # Surrounding ground
        {
            "name": "Surrounding rock",
            "material": 0, "coarseness": 1,
            "x": [0, 60, 60, 0], "y": [0, 0, 60, 60],
            "edge_bc": [4, 2, 0, 2],
            "edge_flow": [], "edge_head": [], "edge_flux": []
        },
        # Tunnel core cluster
        {
            "name": "Tunnel core",
            "material": 0, "coarseness": 0.5,
            "x": tun_x, "y": tun_y,
            "edge_bc": [0]*n_pts,
            "edge_flow": [], "edge_head": [], "edge_flux": []
        }
    ],
    "structs": tun_structs,
    "loads": [], "disps": [], "hydros": [],
    "initial": {**empty_initial("K0 ground", 0), "poly": [1, 1], "struct": [0]*n_pts},
    "phases": [{
        **empty_initial("Excavate and line", 0),
        "poly": [1, 0], "struct": [1]*n_pts, "duration": 1, "steps": 25
    }]
}
(studies_dir / "test-tunnel-ring.k2d").write_text(json.dumps(tunnel_model, separators=(',', ':')), encoding="utf-8")

# 8. test-anchor-retension.k2d (from test_anchor_retension.cpp)
anc_soil = base_material("Elastic ground", model=0, drainage=0, E=1.3e4, nu=0.3, c=1.0, phi=30.0, psi=0.0, gamma=17.0, gamma_sat=20.0)
anc_mat = {
    "name": "Tieback anchor",
    "color": [0.8, 0.2, 0.2],
    "EA": 1.0e5,
    "Lspacing": 2.5,
    "Fmax": 1000.0
}
anchor_model = {
    "katai2d": 29,
    "name": "Test: Ground anchor retensioning",
    "axisymmetric": False,
    "initial_procedure": 0,
    "x_min": 0, "x_max": 20, "y_min": 0, "y_max": 10,
    "has_water": False, "wx": [], "wy": [],
    "mesh": {"elem_size": 1.0, "order": 6, "auto_refine": True, "grading": 0.15},
    "materials": [anc_soil],
    "plates": [],
    "anchors": [anc_mat],
    "geogrids": [], "embedded": [], "strata": [], "boreholes": [],
    "polygons": [{
        "name": "Soil block",
        "material": 0, "coarseness": 1,
        "x": [0, 20, 20, 0], "y": [0, 0, 10, 10],
        "edge_bc": [4, 2, 0, 2],
        "edge_flow": [], "edge_head": [], "edge_flux": []
    }],
    "structs": [
        {
            "kind": 1, "name": "Ground anchor",
            "x1": 5, "y1": 8, "x2": 15, "y2": 3,
            "material": 0, "iface_pos": False, "iface_neg": False, "iface_material": -1,
            "conn": 0, "flow_barrier": 0, "hyd_res": 0, "coarseness": 0.25
        }
    ],
    "loads": [], "disps": [], "hydros": [],
    "initial": {**empty_initial("K0 baseline", 0), "poly": [1], "struct": [0]},
    "phases": [
        {
            **empty_initial("Prestress 300 kN", 0),
            "poly": [1], "struct": [1], "duration": 1, "steps": 25
        },
        {
            **empty_initial("Re-tension to 500 kN", 0),
            "poly": [1], "struct": [1], "duration": 1, "steps": 25
        }
    ]
}
(studies_dir / "test-anchor-retension.k2d").write_text(json.dumps(anchor_model, separators=(',', ':')), encoding="utf-8")
print(f"Generated 8 study preset files in {studies_dir}")

