#!/usr/bin/env bash
# Trace the L2-undrained embankment BUILD phase only (no Safety), tri15, at a given
# substol, with the solver's per-iteration debug and wall-clock timestamps, so we can
# see WHICH increment becomes expensive or fails. Capped at CAP seconds.
# Output: build/verification/trace_<substol>.txt (+ .k2d)
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CLI:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
ST="${1:-1e-4}"
CAP="${CAP:-900}"
V="$REPO/build/verification"
cd "$REPO/scripts/verification" || exit 3
python3 make_profile_case.py --lesson L02 --builder-arg undrained --mstage "${MSTAGE:-1.0}" \
    --substol "$ST" --out "$V/trace_$ST.k2d" > /dev/null
KATAI_NL_DEBUG=1 timeout "$CAP" "$CLI" solve "$V/trace_$ST.k2d" --out "$V/trace_$ST.res" 2>&1 \
  | while IFS= read -r line; do printf '%(%s)T %s\n' -1 "$line"; done > "$V/trace_$ST.txt"
echo "done rc=${PIPESTATUS[0]}" >> "$V/trace_$ST.txt"
