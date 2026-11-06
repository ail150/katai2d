#!/usr/bin/env python3
"""Print each phase's status, message, max|u|, FoS and diagnostics of a solved model.

Usage: python show_phases.py <cli> <model.k2d> [<model.res>]
"""
import json
import subprocess
import sys
from pathlib import Path

cli, model = sys.argv[1], Path(sys.argv[2])
res = Path(sys.argv[3]) if len(sys.argv) > 3 else model.with_suffix(".res")
p = subprocess.run([cli, "results", str(model), str(res)], capture_output=True, text=True)
if p.returncode != 0:
    print("results failed rc", p.returncode, p.stderr[-500:])
    sys.exit(1)
d = json.loads(p.stdout)
for i, ph in enumerate(d["phases"]):
    print(f"[{i}] {ph['name']}: ok={ph['ok']} max|u|={ph['max_disp']} fos={ph['fos']} iters={ph['iterations']}")
    print(f"     message: {ph['message'][:400]}")
    for dg in ph.get("diagnostics", [])[:6]:
        print(f"     {dg['severity']} {dg['code']} {dg['subject']}: {dg['message'][:200]}")
