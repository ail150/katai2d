#!/usr/bin/env python3
"""Compare a KATAI result against a PLAXIS reference, applying the plan's metric.

Scalar (plan D2):   e = |katai - ref| / |ref|            ; pass if e < tolerance
Curve   (plan D2):   katai interpolated onto the reference abscissae x_i, then
                     e_i   = |yk(x_i) - yr(x_i)| / max(|yr(x_i)|, floor)
                     floor = floor_fraction * max_j |yr(x_j)|
                     pass if max_i e_i < tolerance

For a digitised reference whose u_dig is near the tolerance, the verdict is
UNDECIDABLE, not PASS (plan D3): a 2% claim cannot rest on data read to worse
than ~2%. The rule: if u_dig >= 0.75 * tolerance, cap the achievable verdict at
UNDECIDABLE whenever the measured error is within [tolerance - u_dig, tolerance
+ u_dig], i.e. the error and the band cannot be separated given the read noise.

This module is pure (no solver, no PDF). It reads two CSVs (x,y with optional
'# key: value' header lines) or two scalars, and returns a verdict dict. It also
writes an overlay PNG when matplotlib is present and --plot is given.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

PASS = "PASS"
FAIL = "FAIL"
UNDECIDABLE = "UNDECIDABLE"


def read_curve(path):
    """Read a '# header' + 'x,y' CSV into (meta: dict, xs: list, ys: list)."""
    meta, xs, ys = {}, [], []
    for line in Path(path).read_text().splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            body = s[1:].strip()
            if ":" in body:
                k, v = body.split(":", 1)
                meta[k.strip()] = v.strip()
            continue
        if s.lower().startswith("x,y"):
            continue
        parts = s.split(",")
        if len(parts) < 2:
            continue
        try:
            xs.append(float(parts[0]))
            ys.append(float(parts[1]))
        except ValueError:
            continue
    return meta, xs, ys


def _interp(x, xs, ys):
    """Linear interpolation of (xs, ys) at x; xs need not be pre-sorted."""
    pairs = sorted(zip(xs, ys))
    sx = [p[0] for p in pairs]
    sy = [p[1] for p in pairs]
    if x <= sx[0]:
        return sy[0]
    if x >= sx[-1]:
        return sy[-1]
    lo, hi = 0, len(sx) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if sx[mid] <= x:
            lo = mid
        else:
            hi = mid
    if sx[hi] == sx[lo]:
        return sy[lo]
    t = (x - sx[lo]) / (sx[hi] - sx[lo])
    return sy[lo] + t * (sy[hi] - sy[lo])


def _u_dig_of(meta):
    raw = meta.get("u_dig", "")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _verdict(err, tol, u_dig):
    """Map an error to PASS/FAIL/UNDECIDABLE given tolerance and read noise."""
    if u_dig is not None and u_dig >= 0.75 * tol:
        band_lo, band_hi = tol - u_dig, tol + u_dig
        if band_lo <= err <= band_hi:
            return UNDECIDABLE
    return PASS if err < tol else FAIL


def compare_scalar(katai, ref, tolerance=0.02):
    denom = abs(ref) if ref != 0 else 1.0
    err = abs(katai - ref) / denom
    return {
        "kind": "scalar", "katai": katai, "ref": ref,
        "rel_error": err, "tolerance": tolerance,
        "verdict": PASS if err < tolerance else FAIL,
    }


def compare_curve(katai_csv, ref_csv, tolerance=0.02, floor_fraction=0.10, plot_path=None):
    _mk, kx, ky = read_curve(katai_csv)
    rmeta, rx, ry = read_curve(ref_csv)
    if not rx:
        raise ValueError(f"empty reference curve: {ref_csv}")
    floor = floor_fraction * max((abs(v) for v in ry), default=0.0)
    if floor == 0.0:
        floor = 1e-12
    per_point = []
    max_err = 0.0
    for xi, yri in zip(rx, ry):
        yki = _interp(xi, kx, ky)
        denom = max(abs(yri), floor)
        ei = abs(yki - yri) / denom
        per_point.append({"x": xi, "y_ref": yri, "y_katai": yki, "e": ei})
        max_err = max(max_err, ei)
    u_dig = _u_dig_of(rmeta)
    result = {
        "kind": "curve", "ref_csv": str(ref_csv), "katai_csv": str(katai_csv),
        "n_points": len(rx), "floor": floor, "max_error": max_err,
        "tolerance": tolerance, "u_dig": u_dig,
        "verdict": _verdict(max_err, tolerance, u_dig),
        "worst_point": max(per_point, key=lambda p: p["e"]) if per_point else None,
        "per_point": per_point,
    }
    if plot_path:
        _overlay(katai_csv, ref_csv, kx, ky, rx, ry, result, plot_path)
    return result


def _overlay(katai_csv, ref_csv, kx, ky, rx, ry, result, plot_path):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.plot(rx, ry, "-", label="PLAXIS reference", linewidth=2)
    ax.plot(sorted(kx), [y for _, y in sorted(zip(kx, ky))], "--", label="KATAI")
    wp = result["worst_point"]
    if wp:
        ax.plot([wp["x"]], [wp["y_katai"]], "ro", label=f"worst e={wp['e']*100:.1f}%")
    ax.set_title(f"{Path(ref_csv).name}  max_err={result['max_error']*100:.2f}%  {result['verdict']}")
    ax.legend()
    ax.grid(True, alpha=0.3)
    Path(plot_path).parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(plot_path, dpi=110)
    plt.close(fig)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", required=True, help="reference CSV, or a number for scalar mode")
    ap.add_argument("--katai", required=True, help="katai CSV, or a number for scalar mode")
    ap.add_argument("--tolerance", type=float, default=0.02)
    ap.add_argument("--floor-fraction", type=float, default=0.10)
    ap.add_argument("--scalar", action="store_true", help="treat --ref/--katai as numbers")
    ap.add_argument("--plot", help="write an overlay PNG")
    args = ap.parse_args(argv)
    if args.scalar:
        r = compare_scalar(float(args.katai), float(args.ref), args.tolerance)
    else:
        r = compare_curve(args.katai, args.ref, args.tolerance, args.floor_fraction, args.plot)
    print(json.dumps({k: v for k, v in r.items() if k != "per_point"}, indent=2))
    return 0 if r["verdict"] == PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
