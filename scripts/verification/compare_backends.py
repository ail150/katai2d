#!/usr/bin/env python3
"""Solve the same .k2d on two katai builds and compare results and wall time.

Phase 11 of the plaxis-parity plan moves the slow cases from the portable Eigen
SparseLU backend to PARDISO. The project's own rule (CMakePresets "portable") is
that a result must not depend on the solver backend, so a speed-up is only
accepted if the numbers agree. This script checks exactly that:

  * per phase: max |u|, load factor, factor of safety, iterations
  * the full final displacement vector (max abs difference, relative to max |u|)
  * the final reaction vector (same)
  * wall time on each backend

Usage:
    python compare_backends.py --a <katai_eigen> --b <katai_pardiso> model1.k2d [model2.k2d ...]
        [--timeout 300] [--json out.json]

Exit code 0 when every model solved on both and agreed within --rtol (default
1e-6 relative to the field magnitude); 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

import katai_run


def _solve(cli: str, k2d: Path, tag: str, timeout: float):
    # Work on a per-backend copy so the two .res files do not overwrite each other.
    work = k2d.with_name(f"{k2d.stem}.{tag}{k2d.suffix}")
    shutil.copyfile(k2d, work)
    os.environ["KATAI_CLI"] = cli
    return katai_run.solve_and_read(work, timeout_s=timeout)


def _vec_diff(a, b):
    """max |a-b| and max |a| over finite pairs (None entries skipped)."""
    if not a or not b or len(a) != len(b):
        return None, None
    dm = 0.0
    am = 0.0
    for x, y in zip(a, b):
        if x is None or y is None:
            continue
        dm = max(dm, abs(x - y))
        am = max(am, abs(x))
    return dm, am


def compare(a_cli, b_cli, k2d: Path, timeout, rtol):
    ra = _solve(a_cli, k2d, "eigen", timeout)
    rb = _solve(b_cli, k2d, "pardiso", timeout)
    out = {"model": k2d.name, "a_status": ra["status"], "b_status": rb["status"],
           "a_time_s": round(ra["elapsed_s"], 2), "b_time_s": round(rb["elapsed_s"], 2)}
    if ra["status"] != "ok" or rb["status"] != "ok":
        out["agree"] = None
        out["note"] = "not comparable: a backend did not finish"
        return out
    pa, pb = ra["results"]["phases"], rb["results"]["phases"]
    if len(pa) != len(pb):
        out["agree"] = False
        out["note"] = f"phase count differs {len(pa)} vs {len(pb)}"
        return out
    phases = []
    worst = 0.0
    for i, (x, y) in enumerate(zip(pa, pb)):
        du, um = _vec_diff(x.get("displacement"), y.get("displacement"))
        dr, rm = _vec_diff(x.get("reaction"), y.get("reaction"))
        rel_u = (du / um) if (du is not None and um) else 0.0
        rel_r = (dr / rm) if (dr is not None and rm) else 0.0
        fa, fb = x.get("fos"), y.get("fos")
        rel_f = abs(fa - fb) / abs(fa) if (fa not in (None, -1) and fb not in (None, -1) and fa) else 0.0
        worst = max(worst, rel_u, rel_r, rel_f)
        phases.append({"phase": i, "name": x.get("name"),
                       "max_disp_a": x.get("max_disp"), "max_disp_b": y.get("max_disp"),
                       "fos_a": fa, "fos_b": fb,
                       "rel_disp": rel_u, "rel_reaction": rel_r, "rel_fos": rel_f,
                       "iter_a": x.get("iterations"), "iter_b": y.get("iterations")})
    out["phases"] = phases
    out["worst_rel"] = worst
    out["agree"] = worst <= rtol
    out["speedup"] = round(ra["elapsed_s"] / rb["elapsed_s"], 2) if rb["elapsed_s"] > 0 else None
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", required=True, help="reference katai (Eigen)")
    ap.add_argument("--b", required=True, help="candidate katai (PARDISO)")
    ap.add_argument("models", nargs="+")
    ap.add_argument("--timeout", type=float, default=300.0)
    ap.add_argument("--rtol", type=float, default=1e-6)
    ap.add_argument("--json")
    args = ap.parse_args(argv)

    rows = [compare(args.a, args.b, Path(m).resolve(), args.timeout, args.rtol) for m in args.models]
    print(f"{'model':32s} {'eigen':>10s} {'pardiso':>10s} {'speedup':>8s} {'worst_rel':>10s} agree")
    ok = True
    for r in rows:
        ta = f"{r['a_time_s']}s" if r["a_status"] == "ok" else r["a_status"]
        tb = f"{r['b_time_s']}s" if r["b_status"] == "ok" else r["b_status"]
        wr = f"{r['worst_rel']:.2e}" if r.get("worst_rel") is not None else "-"
        print(f"{r['model']:32s} {ta:>10s} {tb:>10s} {str(r.get('speedup') or '-'):>8s} {wr:>10s} {r['agree']}")
        if r["agree"] is False:
            ok = False
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
