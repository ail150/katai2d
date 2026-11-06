#!/usr/bin/env bash
# Count accepted load increments, Newton iterations and cut-backs of a solve,
# fixed-step vs KATAI_AUTO_STEPS, from the solver's KATAI_NL_DEBUG trace.
# Usage: bash scripts/verification/count_steps.sh model.k2d [cli]
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="$REPO/$1"
CLI="${2:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
OUT="$REPO/build/verification"
mkdir -p "$OUT"
for M in fixed auto; do
  if [ "$M" = auto ]; then export KATAI_AUTO_STEPS=1; else unset KATAI_AUTO_STEPS; fi
  T0=$(date +%s)
  KATAI_NL_DEBUG=1 timeout "${CAP:-600}" "$CLI" solve "$MODEL" --out "$OUT/count.res" > "$OUT/dbg_$M.txt" 2>&1
  RC=$?
  T1=$(date +%s)
  steps=$(grep -cE ' iter 0 ' "$OUT/dbg_$M.txt")
  iters=$(grep -cE ' iter [0-9]+ ' "$OUT/dbg_$M.txt")
  cuts=$(grep -ciE 'halved|retrying' "$OUT/dbg_$M.txt")
  lams=$(grep -oE 'lambda [0-9.]+ iter 0' "$OUT/dbg_$M.txt" | awk '{print $2}' | tr '\n' ' ' | cut -c1-200)
  echo "$M rc=$RC time=$((T1-T0))s attempts=$steps iterations=$iters cutbacks=$cuts"
  echo "   lambdas: $lams"
done
unset KATAI_AUTO_STEPS
