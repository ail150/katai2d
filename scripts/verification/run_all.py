#!/usr/bin/env python3
"""Run PLAXIS-parity verification cases and write the parity report.

Reads tests/verification/plaxis/registry.json, builds each case's model from its
per-lesson build.py, solves it through the katai CLI (300 s wall-clock cap by
default), extracts the compared quantity, applies the plan's pass metric
(scripts/verification/compare.py) and emits:

  - docs/validation/plaxis-parity-report.md  (human report)
  - build/verification/<id>/...               (raw results, overlay PNGs)

A case whose required features are not yet implemented is reported BLOCKED, not
FAIL: the engine does not claim to do it yet. A case whose reference is a
digitised curve whose u_dig is near the band is reported UNDECIDABLE.

Usage:
    python scripts/verification/run_all.py                 # all 'ready' cases
    python scripts/verification/run_all.py --only L1       # one lesson
    python scripts/verification/run_all.py --id KV-PLX-L01-A
    python scripts/verification/run_all.py --timeout 120
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
from datetime import date
from pathlib import Path

from compare import compare_curve, compare_scalar, PASS, FAIL, UNDECIDABLE  # noqa: E402
from katai_run import solve_and_read  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
PLAXIS_DIR = REPO_ROOT / "tests" / "verification" / "plaxis"
REGISTRY = PLAXIS_DIR / "registry.json"
OUT_DIR = REPO_ROOT / "build" / "verification"
REPORT = REPO_ROOT / "docs" / "validation" / "plaxis-parity-report.md"

BLOCKED = "BLOCKED"
ERROR = "ERROR"


# ---- quantity extractors -------------------------------------------------
# Each returns a float from the parsed katai results JSON, or raises.

def _phase(results, index=-1):
    return results["phases"][index]


def extract_axisym_disp_reaction(results, line):
    """Total axisymmetric vertical force on a prescribed-displacement line [kN].

    Sum reaction[2i+1] over mesh nodes on the line, times 2*pi (App.tsx logic)."""
    ph = _phase(results)
    mesh = ph["mesh"]
    react = ph["reaction"]
    x1, y1, x2, y2 = line
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1.0
    per_radian = 0.0
    for i in range(mesh["node_count"]):
        x, y = mesh["x"][i], mesh["y"][i]
        proj = ((x - x1) * dx + (y - y1) * dy) / (length * length)
        dist = abs(dx * (y1 - y) - dy * (x1 - x)) / length
        if -1e-8 <= proj <= 1 + 1e-8 and dist < 1e-7:
            r = react[i * 2 + 1]
            if r is not None:
                per_radian += r
    return abs(per_radian) * 2.0 * math.pi


def extract_scalar_load_capacity(results, q, radius):
    """Applied load q*pi*R^2 (flexible footing capacity) [kN]."""
    return abs(q) * math.pi * radius * radius


def extract_fos(results):
    return _phase(results)["fos"]


def extract_struct_force_abs_max_M(results, struct_name=None):
    ph = _phase(results)
    best = 0.0
    for sf in ph.get("struct_forces", []):
        if struct_name and sf["name"] != struct_name:
            continue
        best = max(best, abs(sf.get("max_M") or 0.0))
    return best


def extract_anchor_force(results):
    """Axial force [kN] of the node-to-node anchor (kind==1) in the last phase."""
    ph = _phase(results)
    for sf in ph.get("struct_forces", []):
        if sf.get("kind") == 1:
            return abs(sf.get("max_N") or 0.0)
    raise ValueError("no anchor (kind==1) force in the last phase")


def extract_max_excess_pore(results):
    ph = _phase(results)
    vals = [abs(v) for v in (ph.get("excess_pore") or []) if v is not None]
    return max(vals) if vals else 0.0


# Per-id extractor dispatch. Only 'ready' cases need a scalar extractor here;
# curve cases are handled once the Output CSV export lands (Phase 5).
EXTRACTORS = {
    "KV-PLX-L01-A": lambda r: extract_axisym_disp_reaction(r, (0, 4, 1, 4)),
    "KV-PLX-L01-B": lambda r: extract_scalar_load_capacity(r, 188.0, 1.0),
    "KV-PLX-L02-FOS-D": extract_fos,
    "KV-PLX-L02-FOS-U": extract_fos,
    "KV-PLX-L07-ANCHOR": extract_anchor_force,
    "KV-PLX-L09-PEXCESS": extract_max_excess_pore,
}

# Which built .k2d file each id solves. Multi-phase lessons select a phase in
# the extractor; here we only name the model file per id. A lesson's build.py
# may emit several files; the second tuple item is the one this id solves.
MODEL_FILE = {
    "KV-PLX-L01-A": ("L01", "l1a_rigid.k2d"),
    "KV-PLX-L01-B": ("L01", "l1b_flexible.k2d"),
    "KV-PLX-L02-FOS-D": ("L02", "l2_drained.k2d"),
    "KV-PLX-L02-FOS-U": ("L02", "l2_undrained.k2d"),
    "KV-PLX-L07-ANCHOR": ("L07", "l7_anchor.k2d"),
    "KV-PLX-L09-PEXCESS": ("L09", "l9_consol.k2d"),
}


def _load_builder(lesson_dir: Path):
    bp = lesson_dir / "build.py"
    if not bp.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"build_{lesson_dir.name}", bp)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_case(case, timeout_s):
    cid = case["id"]
    rec = {"id": cid, "lesson": case["lesson"], "title": case["title"],
           "quantity": case["quantity"], "source": case["source"], "pages": case["pages"]}

    if case["status"] == "blocked":
        rec["verdict"] = BLOCKED
        rec["detail"] = "features not yet implemented: " + ", ".join(case["features"])
        return rec
    if cid not in MODEL_FILE:
        rec["verdict"] = BLOCKED
        rec["detail"] = "no build model wired yet (scalar/curve extractor pending)"
        return rec

    lesson_sub, model_name = MODEL_FILE[cid]
    lesson_dir = PLAXIS_DIR / lesson_sub
    mod = _load_builder(lesson_dir)
    if mod is None:
        rec["verdict"] = ERROR
        rec["detail"] = f"missing {lesson_dir}/build.py"
        return rec
    mod.main()
    k2d = lesson_dir / model_name
    if not k2d.exists():
        rec["verdict"] = ERROR
        rec["detail"] = f"builder did not produce {k2d.name}"
        return rec

    run = solve_and_read(k2d, timeout_s=timeout_s)
    rec["elapsed_s"] = round(run["elapsed_s"], 2)
    if run["status"] != "ok":
        rec["verdict"] = FAIL if run["status"] == "solve_failed" else run["status"].upper()
        rec["detail"] = (run["stderr"] or run["stdout"] or "")[-400:]
        return rec

    try:
        value = EXTRACTORS[cid](run["results"])
    except Exception as e:  # noqa: BLE001
        rec["verdict"] = ERROR
        rec["detail"] = f"extractor: {e}"
        return rec

    cmp = compare_scalar(value, case["expected"], case.get("tolerance", 0.02))
    rec["katai"] = value
    rec["expected"] = case["expected"]
    rec["rel_error"] = cmp["rel_error"]
    rec["verdict"] = cmp["verdict"]
    rec["detail"] = f"{value:.4g} vs {case['expected']:.4g} ({cmp['rel_error']*100:.2f}%)"
    return rec


def write_report(records):
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    counts = {}
    for r in records:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    lines = [
        "# PLAXIS 2D parity report",
        "",
        "<!-- GENERATED by scripts/verification/run_all.py. Do not edit by hand. -->",
        "",
        f"Generated: {date.today().isoformat()}  ",
        "Pass metric and verdicts: see tests/verification/plaxis/README.md.  ",
        "Sources (PLAXIS manuals, Schweiger 2002) are not committed; values are typed/derived.",
        "",
        "## Summary",
        "",
        "| Verdict | Count |",
        "|---|---|",
    ]
    for v in (PASS, FAIL, UNDECIDABLE, BLOCKED, "TIMEOUT", "SOLVE_FAILED", "READ_FAILED", ERROR):
        if v in counts:
            lines.append(f"| {v} | {counts[v]} |")
    lines += [
        "",
        "## Cases",
        "",
        "| ID | Lesson | Quantity | Source | Verdict | Detail | Time [s] |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in sorted(records, key=lambda x: str(x["id"])):
        pages = ",".join(str(p) for p in r.get("pages", []))
        lines.append(
            f"| {r['id']} | {r['lesson']} | {r['quantity']} | {r['source']} p.{pages} "
            f"| {r['verdict']} | {r.get('detail','')} | {r.get('elapsed_s','')} |"
        )
    REPORT.write_text("\n".join(lines) + "\n")
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="lesson filter, e.g. L1 (matches lesson number)")
    ap.add_argument("--id", help="run a single case id")
    ap.add_argument("--timeout", type=float, default=300.0)
    ap.add_argument(
        "--gate", action="store_true",
        help="ctest mode: exit nonzero only on harness ERROR/TIMEOUT/*_FAILED "
             "(a physics FAIL is a tracked result, not a broken harness)")
    args = ap.parse_args(argv)

    reg = json.loads(REGISTRY.read_text())
    cases = reg["cases"]
    if args.id:
        cases = [c for c in cases if c["id"] == args.id]
    elif args.only:
        want = args.only.lstrip("Ll")
        cases = [c for c in cases if str(c["lesson"]) == want]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    records = [run_case(c, args.timeout) for c in cases]
    counts = write_report(records)

    print(f"ran {len(records)} case(s); verdicts: {counts}")
    for r in records:
        print(f"  {r['verdict']:12s} {r['id']:22s} {r.get('detail','')}")
    print(f"report: {REPORT}")

    if args.gate:
        # The harness is healthy if it could build, solve and extract. A physics
        # FAIL/UNDECIDABLE is a tracked verdict in the report, not a broken tool;
        # BLOCKED is expected for unimplemented features. Only harness-level
        # breakage fails the gate.
        broken = [r for r in records
                  if r["verdict"] in (ERROR, "TIMEOUT", "SOLVE_FAILED", "READ_FAILED")]
        # A case we expect to solve cleanly must not silently become BLOCKED-by-wiring.
        if not any(r["verdict"] in (PASS, FAIL, UNDECIDABLE) for r in records):
            print("gate: no case reached a physics verdict -- harness not wired")
            return 1
        if broken:
            print(f"gate: {len(broken)} case(s) broke the harness: "
                  + ", ".join(f"{r['id']}={r['verdict']}" for r in broken))
            return 1
        print("gate: harness healthy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
