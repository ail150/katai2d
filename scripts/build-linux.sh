#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python="${PYTHON:-python3}"
jobs="${JOBS:-2}"
run_tests="${RUN_TESTS:-1}"

command -v cmake >/dev/null || { echo "cmake >= 3.25 is required" >&2; exit 2; }
command -v ninja >/dev/null || command -v ninja-build >/dev/null || {
  echo "Ninja is required" >&2; exit 2;
}
"$python" -c 'import nanobind, numpy' >/dev/null || {
  echo "Install Python build dependencies first: python3 -m pip install nanobind numpy" >&2
  exit 2
}

cd "$root"
cmake --preset ubuntu-24.04 -D "Python_EXECUTABLE=$(command -v "$python")"
cmake --build --preset ubuntu-24.04 --parallel "$jobs"
"$python" tests/test_linux_config.py
if [[ "$run_tests" == "1" ]]; then
  ctest --test-dir build/ubuntu-24.04 --output-on-failure --parallel "$jobs"
fi

echo "KATAI Linux build: $root/build/ubuntu-24.04/bin/katai"
