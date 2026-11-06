#!/usr/bin/env python3
"""Fixed-step vs automatic step size on the SAME build (plaxis-parity Phase 11).

Solves each model twice with one katai binary: once as shipped (fixed load
increments), once with KATAI_AUTO_STEPS=1 (desired-iterations step control, the
reference program's scheme). A speed-up is only acceptable if the answer does not
move by more than the phase's own tolerated error, so the script reports, per
phase: max|u|, factor of safety, the largest nodal displacement difference
relative to max|u|, and the reaction difference; plus wall time and step counts.

Usage:
    python compare_autosteps.py --cli <katai> [--timeout S] [--json OUT] model.k2d ...
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

import katai_run


def _vec_diff(a, b):
    if not a or not b or len(a) != len(b):
        return None, None
    dm = am = 0.0
    for x, y in zip(a, b):
        if x is None or y is None:
            continue
        dm = max(dm, abs(x - y))
        am = max(am, abs(x))
    return dm, am


def _solve(cli, k2d: Path, tag, auto, timeout):
    work = k2d.with_name(f"{k2d.stem}.{tag}{k2d.suffix}")
    shutil.copyfile(k2d, work)
    os.environ["KATAI_CLI"] = cli
    if auto:
        os.environ["KATAI_AUTO_STEPS"] = "1"
    else:
        os.environ.pop("KATAI_AUTO_STEPS", None)
    try:
        return katai_run.solve_and_read(work, timeout_s=timeout)
    finally:
        os.environ.pop("KATAI_AUTO_STEPS", None)


def compare(cli, k2d: Path, timeout):
    rf = _solve(cli, k2d, "fixed", False, timeout)
    ra = _solve(cli, k2d, "auto", True, timeout)
    row = {"model": k2d.name, "fixed_status": rf["status"], "auto_status": ra["status"],
           "fixed_time_s": round(rf["elapsed_s"], 2), "auto_time_s": round(ra["elapsed_s"], 2)}
    if rf["status"] != "ok" or ra["status"] != "ok":
        row["note"] = "not comparable: a run did not finish"
        return row
    pf, pa = rf["results"]["phases"], ra["results"]["phases"]
    phases, worst = [], 0.0
    for i, (x, y) in enumerate(zip(pf, pa)):
        du, um = _vec_diff(x.get("displacement"), y.get("displacement"))
        dr, rm = _vec_diff(x.get("reaction"), y.get("reaction"))
        ru = du / um if (du is not None and um) else 0.0
        rr = dr / rm if (dr is not None and rm) else 0.0
        ff, fa = x.get("fos"), y.get("fos")
        rfos = abs(ff - fa) / abs(ff) if (ff not in (None, -1) and fa not in (None, -1) and ff) else 0.0
        worst = max(worst, ru, rr, rfos)
        phases.append({"phase": i, "name": x.get("name"), "ok_fixed": x.get("ok"), "ok_auto": y.get("ok"),
                       "maxu_fixed": x.get("max_disp"), "maxu_auto": y.get("max_disp"),
                       "fos_fixed": ff, "fos_auto": fa,
                       "rel_disp": ru, "rel_reaction": rr, "rel_fos": rfos})
    row.update(phases=phases, worst_rel=worst,
               speedup=round(rf["elapsed_s"] / ra["elapsed_s"], 2) if ra["elapsed_s"] > 0 else None)
    return row


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cli", required=True)
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--json")
    ap.add_argument("models", nargs="+")
    a = ap.parse_args(argv)
    rows = [compare(a.cli, Path(m).resolve(), a.timeout) for m in a.models]
    print(f"{'model':30s} {'fixed':>10s} {'auto':>10s} {'speedup':>8s} {'worst_rel':>10s}")
    for r in rows:
        tf = f"{r['fixed_time_s']}s" if r["fixed_status"] == "ok" else r["fixed_status"]
        ta = f"{r['auto_time_s']}s" if r["auto_status"] == "ok" else r["auto_status"]
        wr = f"{r['worst_rel']:.2e}" if "worst_rel" in r else "-"
        print(f"{r['model']:30s} {tf:>10s} {ta:>10s} {str(r.get('speedup') or '-'):>8s} {wr:>10s}")
        for p in r.get("phases", []):
            print(f"    ph{p['phase']} {str(p['name'])[:22]:22s} maxu {p['maxu_fixed']:.6g} / {p['maxu_auto']:.6g}"
                  f"  fos {p['fos_fixed']} / {p['fos_auto']}  rel_u {p['rel_disp']:.2e}")
    if a.json:
        Path(a.json).write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
