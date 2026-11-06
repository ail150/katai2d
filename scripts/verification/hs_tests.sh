#!/usr/bin/env bash
# Build and run the Hardening Soil test set in the Eigen tree (build/ubuntu-24.04).
#   hs_tests.sh <tag> [VAR=value ...]     -> build/verification/hs_tests_<tag>.log
# Point (a) of the PLAXIS-parity work: what the integrator's pins say about a change.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAG="${1:-default}"; shift || true
for kv in "$@"; do export "$kv"; done
LOG="$REPO/build/verification/hs_tests_$TAG.log"
TESTS="test_anchor_prestress test_hs_axisym test_hs_berlin test_hs_calibration test_hs_cap test_hs_closed_forms test_hs_fe test_hs_fe_oedometer test_hs_footing test_hs_integrate test_hs_multiaxial test_hs_shear test_hs_two_surface test_hs_undrained_bvp test_hs_undrained_clay test_hs_undrained_triaxial test_hssmall test_hssmall_tangent test_input_corpus"
{
  echo "== env: $*"
  cmake --build "$REPO/build/ubuntu-24.04" --target $TESTS 2>&1 | tail -5
  REGEX="^($(echo $TESTS | tr ' ' '|'))"
  cd "$REPO/build/ubuntu-24.04" && ctest -R "$REGEX" --output-on-failure -j 4 --timeout 3000 2>&1 | tail -80
} > "$LOG" 2>&1
echo "done" >> "$LOG"
