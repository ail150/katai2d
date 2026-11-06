# PLAXIS-style Automatic Unstructured Mesh Generator — specification

This is the specification the web app's gmsh mesher implements:
`web/server/plaxis_style_mesher.py` (class `PlaxisStyleMesher`).

It is a **separate mesher** from the engine's own. The engine's C++ mesher
(`katai::mesh::quality_mesh`, reached through `katai::app::mesh_from_project`)
is the one the CLI, the verification corpus and the test suite use; this gmsh
one is what the browser draws. A mesh the user can see in the browser is
therefore not necessarily the mesh the answer was computed on — see
`ARCHITECTURE.md`, section 7, for what that means and what is planned.

The algorithm produces a mesh that is fine around structures, loads, sharp
corners and thin soil layers, and transitions smoothly to coarse in the
far field.

---

## 1. Global element size ($l_e$)

The global target element size follows from the diagonal of the soil domain's
bounding box:

$$l_e = r_e \times 0.05 \times \sqrt{(x_{\max} - x_{\min})^2 + (y_{\max} - y_{\min})^2}$$

**$r_e$ (relative element size)** is set by the user's density preset:

| Preset | $r_e$ |
|---|---|
| `Very Coarse` | 2.0 |
| `Coarse` | 1.5 |
| `Medium` (default) | 1.0 |
| `Fine` | 0.7 |
| `Very Fine` | 0.5 |

An explicit target element size (metres) overrides the preset when it is
greater than zero.

## 2. Local coarseness factor ($f_c$) and attractors

Every geometric entity carries a local size multiplier:

| Entity | $f_c$ |
|---|---|
| Outer soil domain boundary (far field) | 1.0 |
| Stratigraphy line / ordinary soil layer | 0.8 |
| Structural element (Plate, Sheet Pile, Geogrid, Embedded Beam, Tunnel Lining) | 0.25 |
| External load (Point Load, Line Load) | 0.25 |
| Critical zone / refinement zone (polygon or dedicated cluster) | 0.5 |

The local minimum element size on entity $i$ is:

$$h_{\min, i} = f_{c, i} \times l_e$$

## 3. Automatic thin-layer detection

Before meshing, the distance between stratigraphy lines and polygons is
checked:

- where the shortest distance between two layer boundaries is
  $d_{\text{layer}} < l_e$, that segment is marked as an additional
  **attractor**;
- the local element size there is $h_{\min} = \frac{d_{\text{layer}}}{2}$, so
  there are at least 2 elements across the thickness of the thin layer.

Two kinds of proximity are detected: facing boundary segments **within** one
polygon (a thin layer or a constriction), and neighbouring **polygons**
(inter-polygon proximity).

## 4. Conformal geometry (boolean fragmentation)

- **Boolean Fragment** (`gmsh.model.occ.fragment`) merges the soil layer
  polygons, the internal structure lines, the load lines and the monitoring
  points.
- The resulting mesh is **conformal**: a structure line inside the soil
  subdivides the soil elements and they share the same nodes, with no
  overlapping elements and no hanging nodes.

## 5. Mesh size field and gradation control

The background mesh size field $h(\mathbf{x})$ is built from `Distance` and
`Threshold` fields:

- for each entity group with $f_c < 1.0$, a `Distance` field gives the
  Euclidean distance $d(\mathbf{x})$ from the domain coordinates to the
  structure or load;
- a `Threshold` field sets the element size transition:
  - $h(\mathbf{x}) = h_{\min, i}$ for $d(\mathbf{x}) \le d_{\min}$, with
    $d_{\min} = 2.0 \times h_{\min, i}$;
  - $h(\mathbf{x}) = l_e$ for $d(\mathbf{x}) \ge d_{\max}$, with
    $d_{\max} = 0.20 \times$ the bounding-box diagonal for a structure or a
    load, and $0.15 \times$ the diagonal for a thin-layer attractor;
  - a smooth linear or geometric interpolation for
    $d_{\min} < d(\mathbf{x}) < d_{\max}$, keeping the element size growth
    ratio (*mesh gradation*) within $1.15 \le \beta \le 1.3$;
- all `Threshold` fields are combined with the `Min` field operator
  (`gmsh.model.mesh.field.add("Min")`) and set as the background mesh;
- the built-in size determination from points is switched off
  (`MeshSizeFromPoints = 0`, `MeshSizeExtendFromBoundary = 0`), so the
  background field alone controls the mesh size.

## 6. Meshing algorithm and geotechnical element order

- the **Frontal-Delaunay** algorithm (`Mesh.Algorithm = 6` in Gmsh) produces
  the triangles, with an optimal aspect ratio (close to equilateral);
- a **2nd-order (quadratic, 6-node triangle)** option is available, to avoid
  volumetric locking in the plastic collapse analysis.

## 7. The code's shape

The implementation is `web/server/plaxis_style_mesher.py`:

| Member | Purpose |
|---|---|
| `add_soil_polygon(points, material_name, f_c=1.0)` | adds a soil layer or cluster |
| `add_structure_line(start_pt, end_pt, struct_type, f_c=0.25)` | adds a 1D structure element |
| `add_load_line(start_pt, end_pt, f_c=0.25)` | adds an external load line |
| `add_refinement_zone(polygon_points, f_c=0.5)` | adds a critical or refinement zone |
| `detect_thin_layers()` | finds the thin-layer attractors, with `shapely` |
| `generate_mesh(preset="Medium", element_order=2, show_gui=False)` | runs the whole pipeline |
| `export_mesh_data()` | returns the mesh as a dictionary: node coordinates, 2D soil connectivity with its material ids, 1D structure connectivity with its structure ids, and the boundary node set |

`from_project(project_data)` builds a mesher directly from a `.k2d` project's
dict, so the web app can mesh a model it has just loaded or edited.

## 8. Constraints

- the libraries used are `gmsh`, `numpy`, `shapely` and `matplotlib`;
- every method carries type hints and a docstring;
- the nodal and mesh output stays integrated with the existing backend;
- the method is integrated with the canvas that is already there.

---

## See also

- `web/server/plaxis_style_mesher.py` — the implementation.
- `web/server/mesh_runner.py` — how the web app calls it.
- `ARCHITECTURE.md` — the layer contract, and section 7 on the two meshers.
