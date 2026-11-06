#!/usr/bin/env bash
# Point (a): the L2 embankment at the faithful TM numerics (tri15, engine defaults), drained and
# undrained (build + Safety), with the given environment (e.g. KATAI_HS_EDGE=1).
#   l2_edge_check.sh <tag> [VAR=value ...]     env CAP (default 900)
# Log: build/verification/l2_edge_<tag>.log
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CLI:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
TAG="${1:-default}"; shift || true
for kv in "$@"; do export "$kv"; done
V="$REPO/build/verification/l2edge"
mkdir -p "$V"
LOG="$REPO/build/verification/l2_edge_$TAG.log"
echo "== env: $*" > "$LOG"
cd "$REPO/scripts/verification" || exit 3
python3 make_variant.py --lesson L02 --builder-arg drained --out "$V/drained.k2d" > /dev/null
python3 make_variant.py --lesson L02 --builder-arg undrained --out "$V/undrained.k2d" > /dev/null
for m in ${MODELS:-drained undrained}; do
  python3 - "$CLI" "$V/$m.k2d" "$m" "${CAP:-900}" >> "$LOG" 2>&1 <<'PY'
import os, sys
from pathlib import Path
import katai_run
cli, model, tag, cap = sys.argv[1], Path(sys.argv[2]), sys.argv[3], float(sys.argv[4])
os.environ["KATAI_CLI"] = cli
r = katai_run.solve_and_read(model, timeout_s=cap)
s = f"{tag:10s} status={r['status']:8s} time={r['elapsed_s']:7.1f}s"
if r["status"] == "ok":
    ph = r["results"]["phases"]
    s += f" build_maxu={ph[1]['max_disp']:.5e} FoS={ph[-1]['fos']:.4f}"
print(s, flush=True)
PY
done
echo done >> "$LOG"
