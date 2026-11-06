#!/usr/bin/env bash
# Point (a): rebuild the PARDISO CLI, then run the L2-undrained BUILD phase (tri15) with the
# opt-in HS integrator statistics (KATAI_HS_STATS) and the solver's per-iteration trace.
#   hs_stats_run.sh <substol> [tag]      env: MSTAGE (default 1.0), CAP (default 600), NOBUILD=1
# Output: build/verification/hsstats_<tag>.txt (stats snapshot), trace_<substol>.txt (trace)
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ST="${1:-1e-4}"
TAG="${2:-$ST}"
V="$REPO/build/verification"
mkdir -p "$V"
if [ -z "${NOBUILD:-}" ]; then
  bash "$REPO/scripts/verification/build_mkl.sh" || { echo "build failed"; tail -40 "$REPO/build/build_mkl.log"; exit 2; }
fi
export KATAI_HS_STATS="$V/hsstats_$TAG.txt"
rm -f "$KATAI_HS_STATS"
START=$(date +%s)
CAP="${CAP:-600}" bash "$REPO/scripts/verification/l2u_trace.sh" "$ST"
END=$(date +%s)
echo "elapsed $((END-START)) s" >> "$V/trace_$ST.txt"
echo "stats in $KATAI_HS_STATS ; trace in $V/trace_$ST.txt ; elapsed $((END-START)) s"
