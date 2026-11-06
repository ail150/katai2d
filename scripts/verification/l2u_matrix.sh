#!/usr/bin/env bash
# Full L2-undrained (build + Safety) timing/answer matrix on the PARDISO build:
# element order {15, 6} x substol {engine default, 1e-4}. Each run capped at CAP s.
# Results append to build/verification/l2u_matrix.log (survives a dropped client).
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CLI:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
CAP="${CAP:-900}"
V="$REPO/build/verification/l2u"
mkdir -p "$V"
LOG="$REPO/build/verification/l2u_matrix.log"
echo "=== start $(date -u +%H:%M:%S) cli=$CLI cap=$CAP" >> "$LOG"
cd "$REPO/scripts/verification" || exit 3
for order in 15 6; do
  for st in 0 1e-4; do
    tag="o${order}_st${st}"
    args=(--lesson L02 --builder-arg undrained --order "$order" --out "$V/$tag.k2d")
    [ "$st" != 0 ] && args+=(--substol "$st")
    python3 make_variant.py "${args[@]}" > /dev/null
    python3 - "$CLI" "$V/$tag.k2d" "$CAP" "$tag" >> "$LOG" 2>&1 <<'PY'
import os, sys
from pathlib import Path
import katai_run
cli, model, cap, tag = sys.argv[1], Path(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
os.environ["KATAI_CLI"] = cli
os.environ.pop("KATAI_AUTO_STEPS", None)
r = katai_run.solve_and_read(model, timeout_s=cap)
line = f"{tag:12s} status={r['status']:10s} time={r['elapsed_s']:7.1f}s"
if r["status"] == "ok":
    ph = r["results"]["phases"]
    line += f" elems={ph[-1]['mesh']['element_count']} build_maxu={ph[1]['max_disp']:.5e} FoS={ph[-1]['fos']}"
print(line, flush=True)
PY
  done
done
echo "=== done $(date -u +%H:%M:%S)" >> "$LOG"
