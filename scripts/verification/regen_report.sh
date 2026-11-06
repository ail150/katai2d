#!/usr/bin/env bash
# Regenerate docs/validation/plaxis-parity-report.md with the default CLI
# (PARDISO build when present) and a 300 s cap. Log: build/verification/regen.log
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO" || exit 3
python3 scripts/verification/run_all.py --timeout "${CAP:-300}" > build/verification/regen.log 2>&1
echo "RC=$?" >> build/verification/regen.log
