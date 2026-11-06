#!/usr/bin/env python3
"""Extract vector curves from a PDF figure into calibrated CSV.

Used for the Schweiger (2002) benchmark, whose figures are vector (no raster
image on any page): the "reference solution" curves on the cover page and the
B1-B17 entries in Figs. 2-15 are polylines that can be read exactly, and the
tick labels are text that can calibrate the axes.

This is a tool, not a one-click extractor: vector figures overlay many polylines
(axes, grid, several data curves, markers) in one colour space, so the operator
must tell the tool which strokes are the wanted curve. The workflow is:

  1. `--list` dumps every drawing path on a page with its colour, dash, point
     count and bounding box, plus every text span (candidate tick labels).
  2. The operator writes a small JSON spec (see `--emit-spec` for a template)
     naming the two calibration points per axis (pixel -> data) and a filter
     (colour / min-points / bbox) that isolates the curve.
  3. `--extract spec.json` applies the calibration and filter and writes CSV.

The PDF itself is never committed; only the resulting CSV (derived numeric data)
is, together with the spec that produced it, so the extraction is reproducible
by anyone holding the original.

Requires: pymupdf (import name `pymupdf`, legacy `fitz`).

Usage:
    python extract_vector_curves.py --list   <pdf> --page N
    python extract_vector_curves.py --emit-spec > spec.json
    python extract_vector_curves.py --extract spec.json --pdf <pdf> --out <csv>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import pymupdf  # type: ignore
except ImportError:  # pragma: no cover
    try:
        import fitz as pymupdf  # type: ignore
    except ImportError:
        sys.exit("pymupdf (or fitz) is required: pip install pymupdf")


def _color_key(c):
    if c is None:
        return "none"
    if isinstance(c, (int, float)):
        return f"{c:.3f}"
    return ",".join(f"{v:.3f}" for v in c)


def iter_paths(page):
    """Yield (index, polyline_points, meta) for every drawing path on the page.

    A drawing may hold several subpaths; we flatten line/curve items into a
    polyline of (x, y) points in PDF page coordinates (origin top-left).
    """
    for i, d in enumerate(page.get_drawings()):
        pts = []
        for item in d["items"]:
            op = item[0]
            if op == "l":  # line: (p1, p2)
                for p in item[1:3]:
                    pts.append((p.x, p.y))
            elif op == "c":  # bezier: (p1, c1, c2, p2) -> keep endpoints
                pts.append((item[1].x, item[1].y))
                pts.append((item[4].x, item[4].y))
            elif op == "re":  # rectangle
                r = item[1]
                pts.extend([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        meta = {
            "index": i,
            "n_points": len(pts),
            "stroke": _color_key(d.get("color")),
            "fill": _color_key(d.get("fill")),
            "dashes": d.get("dashes", ""),
            "width": d.get("width", 0.0),
            "bbox": [min(xs), min(ys), max(xs), max(ys)],
        }
        yield i, pts, meta


def cmd_list(pdf_path: str, page_no: int):
    doc = pymupdf.open(pdf_path)
    page = doc[page_no - 1]
    print(f"# page {page_no} of {pdf_path}  size={page.rect}")
    print("## text spans (candidate tick labels): text @ (x, y)")
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                t = span["text"].strip()
                if not t:
                    continue
                x, y = span["origin"]
                print(f"  {t!r:>16} @ ({x:.1f}, {y:.1f})")
    print("## drawing paths: idx n_pts stroke fill dashes width bbox")
    for i, _pts, m in iter_paths(page):
        print(
            f"  {m['index']:4d} {m['n_points']:5d} "
            f"stroke={m['stroke']:<18} fill={m['fill']:<12} "
            f"dash={m['dashes']!r:<8} w={m['width']:.2f} "
            f"bbox=[{m['bbox'][0]:.1f},{m['bbox'][1]:.1f},{m['bbox'][2]:.1f},{m['bbox'][3]:.1f}]"
        )


SPEC_TEMPLATE = {
    "pdf": "../plaxis2DSources/geotechBenchmarking.pdf",
    "page": 1,
    "curve_name": "reference solution (final stage)",
    "source": "BM",
    "source_page_label": 1,
    "x_label": "horizontal displacement [mm]",
    "y_label": "depth below surface [m]",
    "_comment": "calibration: two known points, each giving pdf (px) -> data value",
    "calibration": {
        "x": [{"px": 0.0, "data": 0.0}, {"px": 100.0, "data": -70.0}],
        "y": [{"px": 0.0, "data": 0.0}, {"px": 100.0, "data": 32.0}],
    },
    "filter": {
        "stroke_in": ["1.000,0.000,0.000"],
        "min_points": 20,
        "bbox": None,
        "dash_equals": None,
    },
    "sort_by": "y",
}


def _affine(cal):
    (p0, d0), (p1, d1) = (cal[0]["px"], cal[0]["data"]), (cal[1]["px"], cal[1]["data"])
    if p1 == p0:
        raise ValueError("calibration pixels must differ")
    scale = (d1 - d0) / (p1 - p0)
    return lambda px: d0 + (px - p0) * scale


def cmd_extract(spec_path: str, pdf_override: str | None, out_path: str):
    spec = json.loads(Path(spec_path).read_text())
    pdf_path = pdf_override or spec["pdf"]
    doc = pymupdf.open(pdf_path)
    page = doc[spec["page"] - 1]
    fx = _affine(spec["calibration"]["x"])
    fy = _affine(spec["calibration"]["y"])
    flt = spec.get("filter", {})
    stroke_in = set(flt.get("stroke_in") or [])
    min_pts = int(flt.get("min_points", 0))
    bbox = flt.get("bbox")
    dash_eq = flt.get("dash_equals")

    kept = []
    for _i, pts, m in iter_paths(page):
        if stroke_in and m["stroke"] not in stroke_in:
            continue
        if m["n_points"] < min_pts:
            continue
        if dash_eq is not None and m["dashes"] != dash_eq:
            continue
        if bbox is not None:
            bx0, by0, bx1, by1 = bbox
            cx = 0.5 * (m["bbox"][0] + m["bbox"][2])
            cy = 0.5 * (m["bbox"][1] + m["bbox"][3])
            if not (bx0 <= cx <= bx1 and by0 <= cy <= by1):
                continue
        kept.extend(pts)

    if not kept:
        sys.exit("no paths matched the filter; refine the spec with --list")

    data = [(fx(px), fy(py)) for px, py in kept]
    key = {"x": 0, "y": 1}[spec.get("sort_by", "x")]
    data.sort(key=lambda p: p[key])

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as f:
        f.write(f"# curve: {spec['curve_name']}\n")
        f.write(f"# source: {spec['source']} p.{spec['source_page_label']} (vector extraction)\n")
        f.write(f"# x: {spec['x_label']}\n")
        f.write(f"# y: {spec['y_label']}\n")
        f.write(f"# spec: {spec_path}\n")
        f.write("x,y\n")
        for x, y in data:
            f.write(f"{x:.6g},{y:.6g}\n")
    print(f"wrote {len(data)} points to {out}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", metavar="PDF", help="list paths/text on a page")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--emit-spec", action="store_true", help="print a spec template")
    ap.add_argument("--extract", metavar="SPEC", help="extract a curve from a spec json")
    ap.add_argument("--pdf", help="override the pdf path in the spec")
    ap.add_argument("--out", help="output CSV path for --extract")
    args = ap.parse_args(argv)

    if args.emit_spec:
        print(json.dumps(SPEC_TEMPLATE, indent=2))
        return 0
    if args.list:
        cmd_list(args.list, args.page)
        return 0
    if args.extract:
        if not args.out:
            ap.error("--extract requires --out")
        cmd_extract(args.extract, args.pdf, args.out)
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
