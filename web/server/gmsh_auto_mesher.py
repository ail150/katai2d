"""
Automatic Unstructured Mesh Generator (Gmsh + OpenCASCADE)
===========================================================
This module implements a 2D automatic unstructured mesh generator for geotechnical
models. The sizing rules, refinement heuristics, and field construction are
specified in docs/gmsh-auto-mesher.md (implementation note: the public UI exposes
this path as the "studio mesh generator").
- The global element size (l_e) is computed from the bounding-box diagonal and
  the density preset.
- A local coarseness factor (f_c) on structures, loads and reinforcement zones.
- Automatic detection of thin layers (thin-layer proximity) using Shapely.
- Conformal geometry through OpenCASCADE Boolean Fragmentation
  (gmsh.model.occ.fragment).
- A tiered background mesh size field (Distance + Threshold + Min fields).
- The Frontal-Delaunay algorithm (Mesh.Algorithm = 6) and 2nd-order elements
  (6-node quadratic triangle).
"""

from __future__ import annotations
import math
from typing import Any, Sequence, Tuple, List, Dict
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString, MultiLineString, Point
import gmsh


class GmshAutoMesher:
    """Automatic unstructured mesh generator for 2D geotechnical FEM (Gmsh-backed).

    Implements the specification in docs/gmsh-auto-mesher.md:
    - l_e is computed from the bounding-box diagonal and the preset:
      Very Coarse (2.0), Coarse (1.5), Medium (1.0), Fine (0.7), Very Fine (0.5).
    - Local coarseness factor f_c (Structure=0.25, Load=0.25, Thin layer=d/2).
    - OCC Boolean fragmentation for conformal geometry without hanging nodes.
    - A mesh size field built from Distance, Threshold and Min operators.
    - Frontal-Delaunay tri3 / tri6 element generation.
    """

    PRESET_RE: Dict[str, float] = {
        "very coarse": 2.0,
        "coarse": 1.5,
        "medium": 1.0,
        "fine": 0.7,
        "very fine": 0.5,
    }

    def __init__(self, model_name: str = "studio_gmsh_mesh"):
        """Create a new mesher.

        Args:
            model_name: The gmsh model name.
        """
        self.model_name: str = model_name
        self.soil_polygons: List[Dict[str, Any]] = []
        self.structures: List[Dict[str, Any]] = []
        self.loads: List[Dict[str, Any]] = []
        self.refinement_zones: List[Dict[str, Any]] = []
        self.thin_layer_attractors: List[Dict[str, Any]] = []
        self.mesh_data: Dict[str, Any] | None = None
        self._l_e: float = 1.0
        self._diag_bbox: float = 10.0

    def add_soil_polygon(
        self,
        points: Sequence[Sequence[float]],
        material_name: str = "Soil",
        f_c: float = 1.0,
        material_id: int | None = None,
    ) -> int:
        """Add a 2D soil cluster/layer polygon.

        Args:
            points: The corner coordinates [(x0, y0), (x1, y1), ...].
            material_name: The soil material name (e.g. 'Soft Clay', 'Dense Sand').
            f_c: The local density factor (default 1.0 for the far field, 0.8 for
                ordinary stratigraphy).
            material_id: The integer soil material id (optional; automatic if None).

        Returns:
            The index of the polygon that was added.
        """
        idx = len(self.soil_polygons)
        mat_id = idx if material_id is None else material_id
        pts = [tuple(float(c) for c in p[:2]) for p in points]
        if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            raise ValueError(f"A polygon needs at least 3 corner points, got {len(pts)}")

        self.soil_polygons.append({
            "id": idx,
            "points": pts,
            "material_name": material_name,
            "material_id": mat_id,
            "f_c": float(f_c),
        })
        return idx

    def add_structure_line(
        self,
        start_pt: Sequence[float],
        end_pt: Sequence[float],
        struct_type: str = "plate",
        f_c: float = 0.25,
        struct_id: int | None = None,
    ) -> int:
        """Add a 1D structural line element (Plate, Sheet Pile, Geogrid, Embedded Beam, Lining).

        Args:
            start_pt: The line's start coordinate (x, y).
            end_pt: The line's end coordinate (x, y).
            struct_type: The structure type ('plate', 'sheet_pile', 'geogrid',
                'embedded_beam', 'tunnel_lining').
            f_c: The local factor (default 0.25, for a fine mesh around the structure).
            struct_id: The integer structure id (optional).

        Returns:
            The index of the structure line that was added.
        """
        idx = len(self.structures)
        s_id = idx if struct_id is None else struct_id
        p1 = (float(start_pt[0]), float(start_pt[1]))
        p2 = (float(end_pt[0]), float(end_pt[1]))
        if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 1e-6:
            raise ValueError("A structure line must be longer than 0.")

        self.structures.append({
            "id": s_id,
            "start": p1,
            "end": p2,
            "type": struct_type,
            "f_c": float(f_c),
        })
        return idx

    def add_load_line(
        self,
        start_pt: Sequence[float],
        end_pt: Sequence[float],
        f_c: float = 0.25,
        load_id: int | None = None,
    ) -> int:
        """Add an external load line (Line Load / Surface Load).

        Args:
            start_pt: The load's start coordinate (x, y).
            end_pt: The load's end coordinate (x, y).
            f_c: The local factor (default 0.25).
            load_id: The integer load id (optional).

        Returns:
            The index of the load line that was added.
        """
        idx = len(self.loads)
        l_id = idx if load_id is None else load_id
        p1 = (float(start_pt[0]), float(start_pt[1]))
        p2 = (float(end_pt[0]), float(end_pt[1]))

        self.loads.append({
            "id": l_id,
            "start": p1,
            "end": p2,
            "f_c": float(f_c),
        })
        return idx

    def add_refinement_zone(
        self,
        polygon_points: Sequence[Sequence[float]],
        f_c: float = 0.5,
        zone_id: int | None = None,
    ) -> int:
        """Add a critical zone or a dedicated mesh refinement cluster.

        Args:
            polygon_points: The corner coordinates of the zone's boundary polygon.
            f_c: The zone's local factor (default 0.5).
            zone_id: The integer zone id (optional).

        Returns:
            The index of the refinement zone that was added.
        """
        idx = len(self.refinement_zones)
        z_id = idx if zone_id is None else zone_id
        pts = [tuple(float(c) for c in p[:2]) for p in polygon_points]
        if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]

        self.refinement_zones.append({
            "id": z_id,
            "points": pts,
            "f_c": float(f_c),
        })
        return idx

    def compute_bounding_box(self) -> Tuple[float, float, float, float, float]:
        """Hitung bounding box geometri domain dan diagonal total.

        Returns:
            Tuple (xmin, xmax, ymin, ymax, diagonal).
        """
        all_x: List[float] = []
        all_y: List[float] = []

        for p in self.soil_polygons:
            for pt in p["points"]:
                all_x.append(pt[0])
                all_y.append(pt[1])

        for s in self.structures:
            all_x.extend([s["start"][0], s["end"][0]])
            all_y.extend([s["start"][1], s["end"][1]])

        for ld in self.loads:
            all_x.extend([ld["start"][0], ld["end"][0]])
            all_y.extend([ld["start"][1], ld["end"][1]])

        if not all_x:
            return 0.0, 20.0, 0.0, 10.0, math.hypot(20.0, 10.0)

        xmin, xmax = min(all_x), max(all_x)
        ymin, ymax = min(all_y), max(all_y)
        dx = xmax - xmin
        dy = ymax - ymin
        diag = math.hypot(dx, dy)
        return xmin, xmax, ymin, ymax, max(1e-3, diag)

    def calculate_global_element_size(self, preset: str = "Medium", target_element_size: float | None = None) -> float:
        """Compute the global target element size l_e from the preset or a manual size:
        l_e = r_e * 0.05 * sqrt((xmax - xmin)^2 + (ymax - ymin)^2)

        Args:
            preset: The density preset: 'Very Coarse', 'Coarse', 'Medium',
                'Fine', 'Very Fine'.
            target_element_size: An explicit element size in metres (optional;
                it overrides the preset when > 0).

        Returns:
            The value of l_e (metres).
        """
        _, _, _, _, diag = self.compute_bounding_box()
        self._diag_bbox = diag
        if target_element_size is not None and float(target_element_size) > 0:
            self._l_e = float(target_element_size)
            return self._l_e

        r_e = self.PRESET_RE.get(preset.strip().lower(), 1.0)
        self._l_e = r_e * 0.05 * diag
        return self._l_e

    def detect_thin_layers(self, l_e: float | None = None) -> List[Dict[str, Any]]:
        """Detect thin layers automatically (thin-layer / proximity detection) using Shapely.

        If the shortest distance between two layer boundaries is d_layer < l_e,
        that segment is marked as an attractor with the target element size
        h_min = d_layer / 2 (at least 2 elements across the layer's thickness).

        Args:
            l_e: The global element size l_e. If None, it is computed from the
                'Medium' preset.

        Returns:
            The list of detected thin-layer attractor dicts.
        """
        if l_e is None:
            l_e = self._l_e if self._l_e > 0 else self.calculate_global_element_size("Medium")

        self.thin_layer_attractors = []
        if len(self.soil_polygons) < 1:
            return self.thin_layer_attractors

        # Build the shapely geometry for every soil polygon
        poly_objs: List[Tuple[int, Polygon]] = []
        for poly_dict in self.soil_polygons:
            pts = poly_dict["points"]
            if len(pts) >= 3:
                try:
                    sp_poly = Polygon(pts)
                    if sp_poly.is_valid and not sp_poly.is_empty:
                        poly_objs.append((poly_dict["id"], sp_poly))
                except Exception:
                    pass

        # 1. Check the distance between facing boundary segments of the SAME polygon
        #    (a thin layer / a constriction)
        for poly_id, sp_poly in poly_objs:
            coords = list(sp_poly.exterior.coords)
            segments = [LineString([coords[i], coords[i + 1]]) for i in range(len(coords) - 1)]
            n_seg = len(segments)
            for i in range(n_seg):
                s1 = segments[i]
                for j in range(i + 2, n_seg):
                    # Skip the segments that share an endpoint
                    if i == 0 and j == n_seg - 1:
                        continue
                    s2 = segments[j]
                    d = s1.distance(s2)
                    if 1e-4 < d < l_e:
                        h_min = max(0.02, d / 2.0)
                        self.thin_layer_attractors.append({
                            "type": "intra_polygon_thin_layer",
                            "poly_id": poly_id,
                            "distance": d,
                            "h_min": h_min,
                            "seg1": list(s1.coords),
                            "seg2": list(s2.coords),
                        })

        # 2. Check the distance between NEIGHBOURING polygons (inter-polygon proximity)
        for i in range(len(poly_objs)):
            id1, p1 = poly_objs[i]
            for j in range(i + 1, len(poly_objs)):
                id2, p2 = poly_objs[j]
                d = p1.distance(p2)
                if 1e-4 < d < l_e:
                    h_min = max(0.02, d / 2.0)
                    self.thin_layer_attractors.append({
                        "type": "inter_polygon_proximity",
                        "poly_ids": (id1, id2),
                        "distance": d,
                        "h_min": h_min,
                        "geom1": p1,
                        "geom2": p2,
                    })

        return self.thin_layer_attractors

    def generate_mesh(
        self,
        preset: str = "Medium",
        element_order: int = 2,
        show_gui: bool = False,
        target_element_size: float | None = None,
    ) -> Dict[str, Any]:
        """Run the automatic meshing pipeline:
        1. Compute the global element size l_e.
        2. Run the thin-layer detection.
        3. Build the conformal geometry with an OpenCASCADE Boolean Fragment.
        4. Construct the background mesh size field (Distance + Threshold + Min).
        5. Run Frontal-Delaunay meshing at the requested element order
           (1, 2 or 15).
        6. Export all the mesh data (nodes, 2D elements, 1D structure elements).

        Args:
            preset: The density preset: 'Very Coarse', 'Coarse', 'Medium',
                'Fine', 'Very Fine'.
            element_order: The element order: 1 (Tri3 / 3-node linear),
                2 (Tri6 / 6-node quadratic) or 15 (Tri15 / 15-node quartic).
            show_gui: Whether to open Gmsh's own GUI (default False).
            target_element_size: An explicit target element size in metres
                (optional).

        Returns:
            The generated mesh data as a dictionary.
        """
        l_e = self.calculate_global_element_size(preset, target_element_size=target_element_size)
        self.detect_thin_layers(l_e)

        # Initialise Gmsh
        if not gmsh.isInitialized():
            gmsh.initialize(interruptible=False)
        gmsh.clear()
        gmsh.model.add(self.model_name)

        # 1. Add every soil polygon to OpenCASCADE
        occ_surfaces: List[Tuple[int, int]] = []
        poly_to_occ_surf: Dict[int, int] = {}

        for p_idx, p_data in enumerate(self.soil_polygons):
            pts = p_data["points"]
            pt_tags: List[int] = []
            for pt in pts:
                tag = gmsh.model.occ.addPoint(pt[0], pt[1], 0.0)
                pt_tags.append(tag)

            line_tags: List[int] = []
            n_pts = len(pt_tags)
            for i in range(n_pts):
                ltag = gmsh.model.occ.addLine(pt_tags[i], pt_tags[(i + 1) % n_pts])
                line_tags.append(ltag)

            wire_tag = gmsh.model.occ.addWire(line_tags)
            surf_tag = gmsh.model.occ.addPlaneSurface([wire_tag])
            occ_surfaces.append((2, surf_tag))
            poly_to_occ_surf[p_idx] = surf_tag

        # 2. Add the structure lines to OpenCASCADE
        occ_struct_lines: List[Tuple[int, int]] = []
        for s_data in self.structures:
            pt1 = gmsh.model.occ.addPoint(s_data["start"][0], s_data["start"][1], 0.0)
            pt2 = gmsh.model.occ.addPoint(s_data["end"][0], s_data["end"][1], 0.0)
            ltag = gmsh.model.occ.addLine(pt1, pt2)
            occ_struct_lines.append((1, ltag))

        # 3. Add the load lines to OpenCASCADE
        occ_load_lines: List[Tuple[int, int]] = []
        for ld_data in self.loads:
            pt1 = gmsh.model.occ.addPoint(ld_data["start"][0], ld_data["start"][1], 0.0)
            pt2 = gmsh.model.occ.addPoint(ld_data["end"][0], ld_data["end"][1], 0.0)
            ltag = gmsh.model.occ.addLine(pt1, pt2)
            occ_load_lines.append((1, ltag))

        # 4. Conformal Geometry melalui Boolean Fragment
        # fragment(objects, tools)
        tool_dim_tags = occ_struct_lines + occ_load_lines
        if occ_surfaces and tool_dim_tags:
            out_dim_tags, out_map = gmsh.model.occ.fragment(occ_surfaces, tool_dim_tags)
        elif len(occ_surfaces) > 1:
            out_dim_tags, out_map = gmsh.model.occ.fragment([occ_surfaces[0]], occ_surfaces[1:])
        else:
            out_dim_tags = occ_surfaces + tool_dim_tags
            out_map = [[tag] for tag in out_dim_tags]

        gmsh.model.occ.synchronize()

        # Pemetaan balik:
        # out_map memetakan entitas input ke entitas hasil pecahan (fragmented)
        # Indices 0 .. len(occ_surfaces)-1 are the soil polygons
        # The next indices are the structures, then the loads
        frag_surf_to_poly: Dict[int, int] = {}
        for p_idx in range(len(occ_surfaces)):
            if p_idx < len(out_map):
                for dim, tag in out_map[p_idx]:
                    if dim == 2:
                        frag_surf_to_poly[tag] = p_idx

        # Map the structures onto the 1D curves
        struct_curves: List[int] = []
        frag_curve_to_struct: Dict[int, int] = {}
        offset_struct = len(occ_surfaces)
        for s_idx in range(len(occ_struct_lines)):
            map_idx = offset_struct + s_idx
            if map_idx < len(out_map):
                for dim, tag in out_map[map_idx]:
                    if dim == 1:
                        struct_curves.append(tag)
                        frag_curve_to_struct[tag] = s_idx

        # Map the loads onto the 1D curves
        load_curves: List[int] = []
        frag_curve_to_load: Dict[int, int] = {}
        offset_load = offset_struct + len(occ_struct_lines)
        for ld_idx in range(len(occ_load_lines)):
            map_idx = offset_load + ld_idx
            if map_idx < len(out_map):
                for dim, tag in out_map[map_idx]:
                    if dim == 1:
                        load_curves.append(tag)
                        frag_curve_to_load[tag] = ld_idx

        # 5. Background Mesh Size Field & Gradation Control
        field_ids: List[int] = []
        diag = self._diag_bbox

        # a. Structure curves field (f_c = 0.25)
        if struct_curves:
            h_min_struct = 0.25 * l_e
            d_min_struct = 2.0 * h_min_struct
            d_max_struct = 0.20 * diag

            f_dist_s = gmsh.model.mesh.field.add("Distance")
            gmsh.model.mesh.field.setNumbers(f_dist_s, "CurvesList", struct_curves)
            gmsh.model.mesh.field.setNumber(f_dist_s, "Sampling", 100)

            f_thresh_s = gmsh.model.mesh.field.add("Threshold")
            gmsh.model.mesh.field.setNumber(f_thresh_s, "InField", f_dist_s)
            gmsh.model.mesh.field.setNumber(f_thresh_s, "SizeMin", h_min_struct)
            gmsh.model.mesh.field.setNumber(f_thresh_s, "SizeMax", l_e)
            gmsh.model.mesh.field.setNumber(f_thresh_s, "DistMin", d_min_struct)
            gmsh.model.mesh.field.setNumber(f_thresh_s, "DistMax", d_max_struct)
            field_ids.append(f_thresh_s)

        # b. External load curves field (f_c = 0.25)
        if load_curves:
            h_min_load = 0.25 * l_e
            d_min_load = 2.0 * h_min_load
            d_max_load = 0.20 * diag

            f_dist_l = gmsh.model.mesh.field.add("Distance")
            gmsh.model.mesh.field.setNumbers(f_dist_l, "CurvesList", load_curves)
            gmsh.model.mesh.field.setNumber(f_dist_l, "Sampling", 100)

            f_thresh_l = gmsh.model.mesh.field.add("Threshold")
            gmsh.model.mesh.field.setNumber(f_thresh_l, "InField", f_dist_l)
            gmsh.model.mesh.field.setNumber(f_thresh_l, "SizeMin", h_min_load)
            gmsh.model.mesh.field.setNumber(f_thresh_l, "SizeMax", l_e)
            gmsh.model.mesh.field.setNumber(f_thresh_l, "DistMin", d_min_load)
            gmsh.model.mesh.field.setNumber(f_thresh_l, "DistMax", d_max_load)
            field_ids.append(f_thresh_l)

        # c. Thin layer attractors (h_min = d_layer / 2)
        if self.thin_layer_attractors:
            # Take the smallest h_min of the thin layers
            min_thin_h = min(att["h_min"] for att in self.thin_layer_attractors)
            # Find the boundary curves of the thin-layer polygon
            thin_curves: List[int] = []
            for att in self.thin_layer_attractors:
                p_id = att.get("poly_id")
                if p_id is not None:
                    # Find the curves on this polygon surface
                    for stag, parent_pid in frag_surf_to_poly.items():
                        if parent_pid == p_id:
                            boundaries = gmsh.model.getBoundary([(2, stag)], combined=False, oriented=False)
                            for dim, ctag in boundaries:
                                if dim == 1:
                                    thin_curves.append(ctag)

            if thin_curves:
                f_dist_thin = gmsh.model.mesh.field.add("Distance")
                gmsh.model.mesh.field.setNumbers(f_dist_thin, "CurvesList", list(set(thin_curves)))
                gmsh.model.mesh.field.setNumber(f_dist_thin, "Sampling", 100)

                f_thresh_thin = gmsh.model.mesh.field.add("Threshold")
                gmsh.model.mesh.field.setNumber(f_thresh_thin, "InField", f_dist_thin)
                gmsh.model.mesh.field.setNumber(f_thresh_thin, "SizeMin", min_thin_h)
                gmsh.model.mesh.field.setNumber(f_thresh_thin, "SizeMax", l_e)
                gmsh.model.mesh.field.setNumber(f_thresh_thin, "DistMin", 1.5 * min_thin_h)
                gmsh.model.mesh.field.setNumber(f_thresh_thin, "DistMax", 0.15 * diag)
                field_ids.append(f_thresh_thin)

        # d. Gabungkan seluruh threshold fields menggunakan Min operator
        if field_ids:
            f_min = gmsh.model.mesh.field.add("Min")
            gmsh.model.mesh.field.setNumbers(f_min, "FieldsList", field_ids)
            gmsh.model.mesh.field.setAsBackgroundMesh(f_min)

        # 6. Atur konfigurasi algoritma meshing
        if element_order in (4, 15):
            mesh_order = 4
        elif element_order in (2, 6):
            mesh_order = 2
        else:
            mesh_order = 1

        gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
        gmsh.option.setNumber("Mesh.MeshSizeMin", 0.05 * l_e)
        gmsh.option.setNumber("Mesh.MeshSizeMax", l_e)
        gmsh.option.setNumber("Mesh.Algorithm", 6)  # Frontal-Delaunay
        gmsh.option.setNumber("Mesh.ElementOrder", mesh_order)

        # 7. Eksekusi Meshing 2D
        gmsh.model.mesh.generate(2)
        if mesh_order > 1:
            gmsh.model.mesh.setOrder(mesh_order)

        if show_gui:
            gmsh.fltk.run()

        # 8. Ekspor dan Kemas Hasil Mesh
        self.mesh_data = self._package_mesh_data(frag_surf_to_poly, frag_curve_to_struct, element_order)
        return self.mesh_data

    def _package_mesh_data(
        self,
        frag_surf_to_poly: Dict[int, int],
        frag_curve_to_struct: Dict[int, int],
        element_order: int,
    ) -> Dict[str, Any]:
        """Kemas data mesh Gmsh ke dalam format dictionary numerik dan KATAI-compatible."""
        node_tags, coords, _ = gmsh.model.mesh.getNodes()
        nodes_xy = np.array(coords).reshape(-1, 3)[:, :2]
        tag_to_idx = {tag: i for i, tag in enumerate(node_tags)}

        # Collect all the 2D triangle elements
        if element_order in (4, 15):
            target_elem_type = 23  # Triangle 15 (Quartic 15-node)
            nodes_per_elem = 15
            line_npe = 5           # Order 4 1D line element
        elif element_order in (2, 6):
            target_elem_type = 9   # Triangle 6 (Quadratic 6-node)
            nodes_per_elem = 6
            line_npe = 3           # Order 2 1D line element
        else:
            target_elem_type = 2   # Triangle 3 (Linear 3-node)
            nodes_per_elem = 3
            line_npe = 2           # Order 1 1D line element

        all_conn: List[List[int]] = []
        all_materials: List[int] = []

        all_surfs = [tag for dim, tag in gmsh.model.getEntities(2)]
        for stag in all_surfs:
            parent_poly_idx = frag_surf_to_poly.get(stag, 0)
            mat_id = self.soil_polygons[parent_poly_idx]["material_id"] if parent_poly_idx < len(self.soil_polygons) else 0

            elem_types, elem_tags, elem_nodes = gmsh.model.mesh.getElements(2, stag)
            for etype, enodes in zip(elem_types, elem_nodes):
                if etype == target_elem_type:
                    n_elems = len(enodes) // nodes_per_elem
                    for e in range(n_elems):
                        elem_conn = [tag_to_idx[t] for t in enodes[e * nodes_per_elem:(e + 1) * nodes_per_elem]]
                        all_conn.append(elem_conn)
                        all_materials.append(mat_id)

        # Collect all the 1D line elements for the structures
        struct_1d_elems: List[Dict[str, Any]] = []
        for ctag, s_idx in frag_curve_to_struct.items():
            s_data = self.structures[s_idx]
            elem_types, elem_tags, elem_nodes = gmsh.model.mesh.getElements(1, ctag)
            for etype, enodes in zip(elem_types, elem_nodes):
                n_lines = len(enodes) // line_npe
                for le in range(n_lines):
                    l_conn = [tag_to_idx[t] for t in enodes[le * line_npe:(le + 1) * line_npe]]
                    struct_1d_elems.append({
                        "struct_id": s_data["id"],
                        "struct_type": s_data["type"],
                        "connectivity": l_conn,
                    })

        # Identify the boundary nodes (curves bounded by only 1 surface)
        boundary_nodes_set = set()
        for dim, ctag in gmsh.model.getEntities(1):
            adj_surfs, _ = gmsh.model.getAdjacencies(1, ctag)
            if len(adj_surfs) == 1:
                _, _, c_nodes = gmsh.model.mesh.getElements(1, ctag)
                for c_node_arr in c_nodes:
                    for nt in c_node_arr:
                        boundary_nodes_set.add(tag_to_idx[nt])

        boundary_nodes_arr = np.array(sorted(list(boundary_nodes_set)), dtype=int)
        conn_arr = np.array(all_conn, dtype=int)
        mat_arr = np.array(all_materials, dtype=int)

        # Format KATAI .k2d kompatibel
        katai_mesh = {
            "node_count": len(nodes_xy),
            "element_count": len(conn_arr),
            "nodes_per_element": nodes_per_elem,
            "x": [float(x) for x in nodes_xy[:, 0]],
            "y": [float(y) for y in nodes_xy[:, 1]],
            "connectivity": [int(idx) for idx in conn_arr.flatten()],
            "element_material": [int(m) for m in mat_arr],
            "boundary_nodes": [int(b) for b in boundary_nodes_arr],
        }

        return {
            "nodes": nodes_xy,
            "soil_elements": conn_arr,
            "element_material": mat_arr,
            "structure_elements": struct_1d_elems,
            "boundary_nodes": boundary_nodes_arr,
            "katai_mesh": katai_mesh,
            "stats": {
                "node_count": len(nodes_xy),
                "element_count": len(conn_arr),
                "element_order": element_order,
                "global_l_e": self._l_e,
                "diagonal_bbox": self._diag_bbox,
            },
        }

    def export_mesh_data(self) -> Dict[str, Any]:
        """Return the generated mesh data as a dictionary.

        Returns:
            A dictionary holding:
            - 'nodes': np.ndarray shape (N, 2), the (x, y) coordinates
            - 'soil_elements': np.ndarray shape (E, npe), the triangle connectivity
            - 'element_material': np.ndarray shape (E,), the material id of each soil element
            - 'structure_elements': a list of 1D structure element dicts
            - 'boundary_nodes': np.ndarray, the node ids on the outer domain boundary
            - 'katai_mesh': the standard dict the KATAI frontend / solver can take as is
        """
        if self.mesh_data is None:
            raise RuntimeError("No mesh has been generated yet. Call generate_mesh() first.")
        return self.mesh_data

    @classmethod
    def from_project(cls, project_data: Dict[str, Any], model_name: str = "project_mesh") -> "GmshAutoMesher":
        """Build a mesher directly from a .k2d project's dict.

        Args:
            project_data: A KATAI .k2d schema dict.
            model_name: The gmsh model name.

        Returns:
            A GmshAutoMesher ready to generate.
        """
        mesher = cls(model_name=model_name)

        # 1. Add the soil polygons
        polys = project_data.get("polygons") or []
        materials = project_data.get("materials") or []
        for i, p in enumerate(polys):
            xs = p.get("x") or []
            ys = p.get("y") or []
            if len(xs) >= 3 and len(ys) >= 3:
                pts = list(zip(xs, ys))
                mat_idx = int(p.get("material", 0))
                mat_name = materials[mat_idx].get("name", f"Material {mat_idx}") if mat_idx < len(materials) else f"Soil {i}"
                fc = float(p.get("coarseness", 1.0))
                mesher.add_soil_polygon(pts, material_name=mat_name, f_c=fc, material_id=mat_idx)

        # 2. Add the structures
        structs = project_data.get("structs") or []
        kind_names = {0: "plate", 1: "anchor", 2: "geogrid", 3: "embedded_beam", 4: "interface"}
        for s in structs:
            x1, y1 = s.get("x1"), s.get("y1")
            x2 = s.get("x2", x1)
            y2 = s.get("y2", y1)
            if x1 is not None and y1 is not None:
                stype = kind_names.get(int(s.get("kind", 0)), "plate")
                fc = float(s.get("coarseness", 0.25))
                mesher.add_structure_line([x1, y1], [x2, y2], struct_type=stype, f_c=fc, struct_id=s.get("id"))

        # 3. Add the loads
        loads = project_data.get("loads") or []
        for ld in loads:
            x1, y1 = ld.get("x1"), ld.get("y1")
            x2 = ld.get("x2", x1)
            y2 = ld.get("y2", y1)
            if x1 is not None and y1 is not None:
                fc = float(ld.get("coarseness", 0.25))
                mesher.add_load_line([x1, y1], [x2, y2], f_c=fc, load_id=ld.get("id"))

        return mesher
