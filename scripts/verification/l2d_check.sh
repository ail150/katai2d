#!/usr/bin/env bash
# Is (tri6, substol 1e-4) answer-neutral? Solve the DRAINED L2 embankment, which
# finishes at the faithful TM numerics (tri15, engine defaults), both ways and
# compare the factor of safety. Log: build/verification/l2d_check.log
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CLI:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
V="$REPO/build/verification/l2d"
mkdir -p "$V"
LOG="$REPO/build/verification/l2d_check.log"
: > "$LOG"
cd "$REPO/scripts/verification" || exit 3
python3 make_variant.py --lesson L02 --builder-arg drained --out "$V/o15_default.k2d" > /dev/null
python3 make_variant.py --lesson L02 --builder-arg drained --order 6 --substol 1e-4 --out "$V/o6_st1e-4.k2d" > /dev/null
python3 make_variant.py --lesson L02 --builder-arg drained --order 15 --substol 1e-4 --out "$V/o15_st1e-4.k2d" > /dev/null
for m in o15_default o15_st1e-4 o6_st1e-4; do
  python3 - "$CLI" "$V/$m.k2d" "$m" >> "$LOG" 2>&1 <<'PY'
import os, sys
from pathlib import Path
import katai_run
cli, model, tag = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
os.environ["KATAI_CLI"] = cli
r = katai_run.solve_and_read(model, timeout_s=900)
s = f"{tag:12s} status={r['status']:8s} time={r['elapsed_s']:7.1f}s"
if r["status"] == "ok":
    ph = r["results"]["phases"]
    s += f" elems={ph[-1]['mesh']['element_count']} build_maxu={ph[1]['max_disp']:.5e} FoS={ph[-1]['fos']:.4f}"
print(s, flush=True)
PY
done
cat "$LOG"
