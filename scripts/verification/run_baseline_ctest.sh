#!/usr/bin/env bash
# One-shot baseline: run the full ctest suite, record per-test durations.
# Output: /tmp/katai_baseline_ctest.log  and  build/ubuntu-24.04/Testing/.../ for raw.
set -u
BUILD="/mnt/c/Users/THIN 15 RYZEN/Documents/FEM/katai2d/build/ubuntu-24.04"
cd "$BUILD" || exit 3
START=$(date +%s)
ctest --output-on-failure --timeout 600 > /tmp/katai_baseline_ctest.log 2>&1
RC=$?
END=$(date +%s)
echo "EXIT=$RC ELAPSED_S=$((END-START))" | tee -a /tmp/katai_baseline_ctest.log
echo "DONE" > /tmp/katai_baseline_ctest.done
