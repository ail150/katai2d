#!/usr/bin/env python3
"""Throwaway: localise L2-undrained cost -- build phase vs Safety phase."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from katai_run import solve_and_read  # noqa: E402
import importlib.util  # noqa: E402

bp = HERE.parent.parent / "tests" / "verification" / "plaxis" / "L02" / "build.py"
spec = importlib.util.spec_from_file_location("b2", bp)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

tmp = HERE.parent.parent / "build" / "verification" / "_ls"
tmp.mkdir(parents=True, exist_ok=True)


def run(tag, mut):
    m = b.build(True)
    mut(m)
    f = tmp / f"l2u_{tag}.k2d"
    f.write_text(json.dumps(m))
    r = solve_and_read(f, timeout_s=200)
    msg = ""
    if r["status"] == "ok":
        last = r["results"]["phases"][-1]
        msg = f"FoS={last.get('fos')} phases={len(r['results']['phases'])}"
    print(f"{tag:>16} {r['status']:>10} {r['elapsed_s']:>7.1f}s  {msg}")


# Build only (drop the Safety phase).
run("build_only", lambda m: m.__setitem__("phases", m["phases"][:1]))
# Full (build + Safety).
run("build+safety", lambda m: None)
