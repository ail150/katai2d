#!/usr/bin/env bash
# Compare the Eigen (build/ubuntu-24.04) and PARDISO (build/ubuntu-24.04-mkl)
# CLIs on the given .k2d models (paths relative to the repo root).
# Usage: bash scripts/verification/run_backend_compare.sh [--timeout S] [--json OUT] model.k2d ...
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO/scripts/verification" || exit 3
ARGS=()
for a in "$@"; do
  case "$a" in
    --*|[0-9]*) ARGS+=("$a") ;;
    /*) ARGS+=("$a") ;;
    *) if [ -f "$REPO/$a" ]; then ARGS+=("$REPO/$a"); else ARGS+=("$a"); fi ;;
  esac
done
exec python3 compare_backends.py \
  --a "$REPO/build/ubuntu-24.04/bin/katai" \
  --b "$REPO/build/ubuntu-24.04-mkl/bin/katai" \
  "${ARGS[@]}"
