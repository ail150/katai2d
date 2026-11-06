#!/usr/bin/env bash
# Measure the true wall time of slow PLAXIS-parity cases on a given katai build,
# with a generous cap (default 1500 s) so we learn how far over 300 s they are.
# Survives a dropped client connection: everything goes to build/verification/uncapped-<tag>.log.
#
# Usage: bash scripts/verification/measure_uncapped.sh <cli> <tag> <case-id> [<case-id> ...]
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$1"; TAG="$2"; shift 2
LOG="$REPO/build/verification/uncapped-$TAG.log"
mkdir -p "$REPO/build/verification"
: > "$LOG"
cd "$REPO" || exit 3
for id in "$@"; do
  echo "=== $id ($(date -u +%H:%M:%S)) ===" >> "$LOG"
  KATAI_CLI="$CLI" python3 scripts/verification/run_all.py --id "$id" --timeout "${CAP:-1500}" >> "$LOG" 2>&1
done
echo "ALL_DONE $(date -u +%H:%M:%S)" >> "$LOG"
