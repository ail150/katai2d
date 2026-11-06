#!/usr/bin/env bash
# Build the PARDISO-backed CLI and the two PARDISO tests (plaxis-parity Phase 11).
# Log: build/build_mkl.log ; marker build/build_mkl.done (contains the exit code).
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$REPO/build/build_mkl.log"
DONE="$REPO/build/build_mkl.done"
rm -f "$DONE"
cmake --build "$REPO/build/ubuntu-24.04-mkl" --target katai_cli test_pardiso_smoke test_pardiso_solver \
    > "$LOG" 2>&1
RC=$?
echo "BUILD_RC=$RC" >> "$LOG"
echo "$RC" > "$DONE"
exit $RC
