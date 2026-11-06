#!/usr/bin/env python3
"""Semi-manual digitiser for raster figures (PLAXIS Tutorial Manual).

The Tutorial Manual figures are screenshots (raster), so curves cannot be read
as vectors. The operator clicks points along the curve; this tool turns pixel
clicks into calibrated data and, crucially, estimates the DIGITISING
UNCERTAINTY u_dig by re-reading four known tick marks and measuring how far the
calibration misplaces them. If u_dig approaches the 2 % pass band, the case is
reported UNDECIDABLE rather than PASS (plan decision D3).

Two modes:

  --calibrate : given a figure PNG and a JSON of pixel clicks for four known
                axis ticks (two per axis), report the affine map and u_dig.
  --digitise  : given the calibration JSON plus a list of curve pixel clicks,
                write the calibrated CSV with u_dig recorded in the header.

Clicks are supplied as JSON (produced by any image viewer that reports pixel
coordinates, or by the companion notebook), so this script has no GUI
dependency and runs headless in CI to RE-VERIFY an existing CSV against its
recorded clicks.

Calibration JSON schema:
{
  "figure_png": "L01/fig1-27.png",
  "source": "TM", "source_page": 39, "figure": "1-27",
  "x_label": "|u| [m]", "y_label": "SumMstage [-]",
  "x_ticks": [{"px": 120.0, "data": 0.0}, {"px": 980.0, "data": 0.05}],
  "y_ticks": [{"px": 760.0, "data": 0.0}, {"px": 60.0,  "data": 1.0}],
  "x_check": [{"px": 335.0, "data": 0.0125}, {"px": 765.0, "data": 0.0375}],
  "y_check": [{"px": 585.0, "data": 0.25},   {"px": 235.0, "data": 0.75}],
  "axis_range": {"x": [0.0, 0.05], "y": [0.0, 1.0]}
}
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def affine(ticks):
    (a, b) = ticks
    if a["px"] == b["px"]:
        raise ValueError("calibration pixels must differ")
    scale = (b["data"] - a["data"]) / (b["px"] - a["px"])
    return lambda px: a["data"] + (px - a["px"]) * scale


def estimate_u_dig(cal):
    """Max misplacement of the check ticks, as a fraction of the axis range."""
    fx = affine(cal["x_ticks"])
    fy = affine(cal["y_ticks"])
    rng = cal["axis_range"]
    xr = abs(rng["x"][1] - rng["x"][0])
    yr = abs(rng["y"][1] - rng["y"][0])
    errs = []
    for c in cal.get("x_check", []):
        errs.append(abs(fx(c["px"]) - c["data"]) / xr)
    for c in cal.get("y_check", []):
        errs.append(abs(fy(c["px"]) - c["data"]) / yr)
    return max(errs) if errs else None


def cmd_calibrate(cal_path: str):
    cal = json.loads(Path(cal_path).read_text())
    u = estimate_u_dig(cal)
    print(f"figure: {cal.get('figure')} ({cal['source']} p.{cal.get('source_page')})")
    if u is None:
        print("u_dig: NOT ESTIMATED (no check ticks supplied) -- add x_check/y_check")
    else:
        print(f"u_dig: {u*100:.3f}% of axis range")
        if u >= 0.015:
            print("  WARNING: u_dig is close to the 2% band; curves from this figure")
            print("           will be reported UNDECIDABLE, not PASS.")
    return 0


def cmd_digitise(cal_path: str, clicks_path: str, out_path: str):
    cal = json.loads(Path(cal_path).read_text())
    clicks = json.loads(Path(clicks_path).read_text())  # [{"px_x":..,"px_y":..}, ...]
    fx = affine(cal["x_ticks"])
    fy = affine(cal["y_ticks"])
    u = estimate_u_dig(cal)
    data = sorted(((fx(c["px_x"]), fy(c["px_y"])) for c in clicks), key=lambda p: p[0])

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as f:
        f.write(f"# curve: digitised {cal.get('figure')}\n")
        f.write(f"# source: {cal['source']} p.{cal.get('source_page')} (raster digitisation)\n")
        f.write(f"# x: {cal.get('x_label')}\n")
        f.write(f"# y: {cal.get('y_label')}\n")
        f.write(f"# u_dig: {'' if u is None else f'{u:.5f}'} (fraction of axis range)\n")
        f.write("x,y\n")
        for x, y in data:
            f.write(f"{x:.6g},{y:.6g}\n")
    print(f"wrote {len(data)} points to {out} (u_dig={'?' if u is None else f'{u*100:.2f}%'})")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    c = sub.add_parser("calibrate")
    c.add_argument("calibration")
    d = sub.add_parser("digitise")
    d.add_argument("calibration")
    d.add_argument("clicks")
    d.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    if args.cmd == "calibrate":
        return cmd_calibrate(args.calibration)
    if args.cmd == "digitise":
        return cmd_digitise(args.calibration, args.clicks, args.out)
    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
