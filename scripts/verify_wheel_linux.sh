#!/usr/bin/env bash
# Verify the WHEEL, the way scripts/build_wheel.ps1 does for the Windows wheel, but
# for the Linux wheel this machine can actually produce (the Windows host has no MSVC).
#
# The staged package (build/ubuntu-24.04/python/katai) is what the wheel ships, so the
# wheel is built FROM the staged copy -- not from the source tree. That is the point:
# a stale staged module would ship, and the only way to see it is to build the wheel
# from the staged package.
#
# The verification is a clean room: a fresh venv, no PYTHONPATH, no KATAI_DLL_PATH, and
# the checks are the ones the wheel build's own script makes.
set -u

R="/mnt/c/Users/THIN 15 RYZEN/Documents/FEM/katai2d"
STAGED="$R/build/ubuntu-24.04/python/katai"
WORK="${TMPDIR:-/tmp}/katai-wheel-verify"
CORPUS="$R/tests/corpus"

rm -rf "$WORK"
mkdir -p "$WORK/pkg/katai" "$WORK/dist"

echo ">>> staging the package for the wheel (from the BUILD STAGE, not the source)"
for f in "$STAGED"/*.py "$STAGED"/*.so "$STAGED"/*.pyi; do
    [ -e "$f" ] || continue
    cp "$f" "$WORK/pkg/katai/"
done
ls "$WORK/pkg/katai" | sed 's/^/    /'

cat > "$WORK/pkg/pyproject.toml" <<'TOML'
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "katai2d"
version = "0.10.0.dev0"
description = "Verification-first 2D geotechnical finite element analysis -- engine, Python API and CLI"
readme = "README.md"
requires-python = ">=3.10"
license = { text = "Apache-2.0" }
dependencies = ["numpy"]

[project.scripts]
katai = "katai.cli:main"

[tool.setuptools]
packages = ["katai"]

[tool.setuptools.package-data]
katai = ["*.so", "*.pyd", "*.pyi"]
TOML

cat > "$WORK/pkg/setup.py" <<'PY'
from setuptools import setup
from setuptools.dist import Distribution


class BinaryDistribution(Distribution):
    def has_ext_modules(self):
        return True


setup(distclass=BinaryDistribution)
PY

cat > "$WORK/pkg/README.md" <<'MD'
# KATAI 2D

A verification-first 2D finite element engine for geotechnical engineering.

`pip install katai2d` provides the `katai` Python package and the `katai` command
line (`solve` / `mesh` / `results` / `validate` / `info`, documented exit codes).
Units are fixed: kN, m, day.
MD

echo ">>> building the wheel"
cd "$WORK/pkg" || exit 1
python3 -m pip install --quiet --disable-pip-version-check build >/dev/null 2>&1
python3 -m build --wheel --outdir "$WORK/dist" . > "$WORK/build.log" 2>&1
if [ $? -ne 0 ]; then
    echo ">>> WHEEL BUILD FAILED"
    tail -n 25 "$WORK/build.log" | sed 's/^/    /'
    exit 1
fi
WHEEL=$(ls "$WORK/dist"/*.whl | head -n 1)
echo ">>> wheel: $(basename "$WHEEL") ($(( $(stat -c %s "$WHEEL") / 1048576 )) MB)"

echo ">>> the wheel's contents (the mesher must NOT be here):"
python3 -c "
import zipfile, sys
names = zipfile.ZipFile('$WHEEL').namelist()
for n in sorted(names):
    print('    ' + n)
"

echo ">>> clean-room install"
python3 -m venv "$WORK/venv" || exit 1
VPY="$WORK/venv/bin/python"
VKATAI="$WORK/venv/bin/katai"
"$VPY" -m pip install --quiet --disable-pip-version-check "$WHEEL" || {
    echo ">>> pip install FAILED"; exit 1; }

# A clean room: no PYTHONPATH, no KATAI_DLL_PATH.
unset PYTHONPATH
unset KATAI_DLL_PATH
export PYTHONDONTWRITEBYTECODE=1

fail=0
check() {  # check <label> <expected-exit> <command...>
    local label="$1" want="$2"; shift 2
    "$@" > "$WORK/out.txt" 2>&1
    local got=$?
    if [ "$got" != "$want" ]; then
        echo ">>> FAIL $label: exit $got, expected $want"
        sed 's/^/      /' "$WORK/out.txt" | head -n 12
        fail=1
    else
        echo ">>> ok   $label (exit $got)"
    fi
}

echo ">>> the installed package"
check "import katai"            0 "$VPY" -c "import katai; print(katai.__version__)"
check "import katai._core"       0 "$VPY" -c "import katai._core as c; print(c.__version__)"
check "katai info"               0 "$VKATAI" info
check "validate"                 0 "$VKATAI" validate "$CORPUS/kv-slp-001-griffiths-lane-slope.k2d"
check "validate --json"          0 "$VKATAI" validate "$CORPUS/kv-slp-001-griffiths-lane-slope.k2d" --json
check "mesh"                     0 "$VKATAI" mesh "$CORPUS/kv-slp-001-griffiths-lane-slope.k2d"

RES="$WORK/verify.res"
check "solve --out"              0 "$VKATAI" solve "$CORPUS/kv-num-003-k0-geostatic-block.k2d" --out "$RES"
if [ ! -f "$RES" ]; then echo ">>> FAIL solve --out wrote no .res"; fail=1; fi
check "results"                  0 "$VKATAI" results "$CORPUS/kv-num-003-k0-geostatic-block.k2d" "$RES"

echo ">>> the new front-end surface, from the INSTALLED wheel"
check "load_results"             0 "$VPY" -c "
import katai
from katai import load_results
v = load_results('$RES')
print('phases:', len(v))
"
check "mesh_from_project"        0 "$VPY" -c "
import json, katai
from katai import mesh_from_project
pr = katai.Project.from_dict(json.load(open('$CORPUS/kv-slp-001-griffiths-lane-slope.k2d')))
m = mesh_from_project(pr)
print('elements:', m.mesh['element_count'])
"
check "generate_stratigraphy"    0 "$VPY" -c "
import katai
from katai import generate_stratigraphy
pr = katai.Project()
out = generate_stratigraphy(pr)
print('ok:', out is not None)
"

echo ">>> the module that was DELETED must not be importable from the wheel"
"$VPY" -c "import katai.mesher" > "$WORK/out.txt" 2>&1
if [ $? -eq 0 ]; then
    echo ">>> FAIL katai.mesher is still shipped by the wheel"
    fail=1
else
    echo ">>> ok   katai.mesher is gone from the wheel (as it should be)"
fi

if [ "$fail" != 0 ]; then
    echo ">>> WHEEL VERIFICATION FAILED"
    exit 1
fi
echo ">>> WHEEL VERIFIED: clean venv, scrubbed environment, every command and every new binding answered"
