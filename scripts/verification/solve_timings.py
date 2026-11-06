#!/usr/bin/env python3
"""Measure katai solve wall-clock over the regression corpus and studies.

Phase 0 / Phase 11 input: for each tests/corpus/*.k2d and tests/studies/*.k2d,
solve it (with --timings) under a wall-clock cap and record elapsed time,
element count and step count. Cases over the cap are the Phase 11 queue.

Writes a markdown table to stdout and (with --out) to a file.

Usage:
    python scripts/verification/solve_timings.py --cap 300
    python scripts/verification/solve_timings.py --glob "tests/corpus/*.k2d" --cap 120
"""
from __future__ import annotations

import argparse
import glob
from pathlib import Path

from katai_run import solve_and_read  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]


def measure(paths, cap):
    rows = []
    for p in paths:
        p = Path(p)
        run = solve_and_read(p, timeout_s=cap, timings=True)
        elems = steps = None
        if run["status"] == "ok" and run["results"]:
            phs = run["results"]["phases"]
            if phs:
                elems = phs[-1]["mesh"]["element_count"]
            steps = sum(int(ph.get("iterations") or 0) for ph in phs)
        rows.append({
            "name": p.name, "status": run["status"],
            "elapsed_s": round(run["elapsed_s"], 1), "elements": elems, "iters": steps,
        })
        flag = "" if run["status"] == "ok" and run["elapsed_s"] <= cap else "  <-- Phase 11"
        print(f"  {p.name:45s} {run['status']:12s} {run['elapsed_s']:7.1f}s{flag}")
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--glob", action="append",
                    help="file glob(s); default corpus + studies")
    ap.add_argument("--cap", type=float, default=300.0)
    ap.add_argument("--out", help="append a markdown table here")
    args = ap.parse_args(argv)

    globs = args.glob or ["tests/corpus/*.k2d", "tests/studies/*.k2d"]
    paths = []
    for g in globs:
        paths.extend(sorted(glob.glob(str(REPO_ROOT / g))))
    if not paths:
        print("no files matched")
        return 1

    print(f"measuring {len(paths)} model(s), cap {args.cap:.0f} s:")
    rows = measure(paths, args.cap)

    over = [r for r in rows if r["status"] != "ok" or r["elapsed_s"] > args.cap]
    lines = [
        "| Model | Status | Time [s] | Elements | Iterations |",
        "|---|---|---|---|---|",
    ]
    for r in sorted(rows, key=lambda x: -(x["elapsed_s"])):
        lines.append(f"| {r['name']} | {r['status']} | {r['elapsed_s']} "
                     f"| {r['elements'] if r['elements'] is not None else ''} "
                     f"| {r['iters'] if r['iters'] is not None else ''} |")
    table = "\n".join(lines)
    print("\n" + table)
    print(f"\nover cap or failed: {len(over)} / {len(rows)}")
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "a") as f:
            f.write("\n### Solve timings (cap {:.0f} s)\n\n".format(args.cap))
            f.write(table + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
