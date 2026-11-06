#!/usr/bin/env bash
# Install the minimal Intel MKL set needed for the PARDISO linear-solver backend
# (plaxis-parity plan Phase 11). The full `intel-mkl` metapackage pulls the
# cluster/doc/ILP64 sets and stalled an interactive apt run for 30 minutes; the
# PARDISO backend only needs the dev headers plus the LP64 interface, GNU-thread
# and core layers.
#
# Usage (from the repo root, inside WSL/Ubuntu, as root):
#     bash scripts/verification/install_mkl.sh
#
# Writes its log to build/install_mkl.log and a marker build/install_mkl.done.
set -u
export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$REPO/build/install_mkl.log"
DONE="$REPO/build/install_mkl.done"
rm -f "$DONE"
mkdir -p "$REPO/build"

timeout 900 apt-get install -y --no-install-recommends \
    libmkl-dev libmkl-intel-lp64 libmkl-gnu-thread libmkl-core > "$LOG" 2>&1
RC=$?
echo "APT_RC=$RC" >> "$LOG"
echo "$RC" > "$DONE"
tail -8 "$LOG"
exit $RC
