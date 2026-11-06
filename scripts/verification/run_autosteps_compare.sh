#!/usr/bin/env bash
# Fixed vs automatic step size on the PARDISO build. Paths relative to repo root.
# Log mirrors to build/verification/autosteps.log so a dropped connection loses nothing.
# Usage: bash scripts/verification/run_autosteps_compare.sh [--timeout S] model.k2d ...
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO/scripts/verification" || exit 3
ARGS=()
for a in "$@"; do
  case "$a" in
    --*|[0-9]*|/*) ARGS+=("$a") ;;
    *) if [ -f "$REPO/$a" ]; then ARGS+=("$REPO/$a"); else ARGS+=("$a"); fi ;;
  esac
done
mkdir -p "$REPO/build/verification"
python3 compare_autosteps.py --cli "${KATAI_CLI_B:-$REPO/build/ubuntu-24.04-mkl/bin/katai}" \
  --json "$REPO/build/verification/autosteps.json" "${ARGS[@]}" 2>&1 | tee "$REPO/build/verification/autosteps.log"
