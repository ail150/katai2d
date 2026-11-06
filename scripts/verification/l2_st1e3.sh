#!/usr/bin/env bash
# tri15 (the TM element) with HS substol 1e-3: neutrality on the drained L2, then
# the full undrained L2 with a 1500 s cap. Log: build/verification/l2_st1e3.log
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CLI:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
V="$REPO/build/verification/l2s3"
mkdir -p "$V"
LOG="$REPO/build/verification/l2_st1e3.log"
: > "$LOG"
cd "$REPO/scripts/verification" || exit 3
python3 make_variant.py --lesson L02 --builder-arg drained   --order 15 --substol 1e-3 --out "$V/d_o15_st1e-3.k2d" > /dev/null
python3 make_variant.py --lesson L02 --builder-arg undrained --order 15 --substol 1e-3 --out "$V/u_o15_st1e-3.k2d" > /dev/null
for m in d_o15_st1e-3 u_o15_st1e-3; do
  python3 - "$CLI" "$V/$m.k2d" "$m" >> "$LOG" 2>&1 <<'PY'
import os, sys
from pathlib import Path
import katai_run
cli, model, tag = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
os.environ["KATAI_CLI"] = cli
r = katai_run.solve_and_read(model, timeout_s=1500)
s = f"{tag:14s} status={r['status']:8s} time={r['elapsed_s']:7.1f}s"
if r["status"] == "ok":
    ph = r["results"]["phases"]
    s += f" build_maxu={ph[1]['max_disp']:.5e} FoS={ph[-1]['fos']:.4f}"
print(s, flush=True)
PY
done
echo DONE >> "$LOG"
