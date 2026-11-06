#!/usr/bin/env bash
# HS constitutive substep tolerance study (plaxis-parity Phase 11).
# Builds the 10% L2-undrained build-phase profiling case at several substol values,
# solves each on the PARDISO build and compares the displacement field to the
# engine-default (1e-5) answer. Log: build/verification/substol.log
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CLI:-$REPO/build/ubuntu-24.04-mkl/bin/katai}"
V="$REPO/build/verification"
mkdir -p "$V"
LOG="$V/substol.log"
: > "$LOG"
cd "$REPO/scripts/verification" || exit 3
MODELS=()
for st in 1e-5 1e-4 1e-3; do
  python3 make_profile_case.py --lesson L02 --builder-arg undrained --mstage "${MSTAGE:-0.1}" \
      --substol "$st" --out "$V/sub_$st.k2d" >> "$LOG" 2>&1
  MODELS+=("$V/sub_$st.k2d")
done
python3 - "$CLI" "${MODELS[@]}" >> "$LOG" 2>&1 <<'PY'
import os, sys, shutil
import katai_run
cli, models = sys.argv[1], sys.argv[2:]
os.environ["KATAI_CLI"] = cli
os.environ.pop("KATAI_AUTO_STEPS", None)
runs = []
for m in models:
    r = katai_run.solve_and_read(__import__("pathlib").Path(m), timeout_s=900)
    runs.append((m, r))
ref = runs[0][1]
def disp(r):
    return r["results"]["phases"][-1]["displacement"] if r["status"] == "ok" else None
ru = disp(ref)
umax = max(abs(v) for v in ru if v is not None)
print(f"{'substol':>8} {'status':>8} {'time':>7} {'max|u|':>12} {'rel_vs_1e-5':>12}")
for m, r in runs:
    st = os.path.basename(m)[4:-4]
    if r["status"] != "ok":
        print(f"{st:>8} {r['status']:>8} {r['elapsed_s']:7.1f}"); continue
    d = disp(r)
    rel = max(abs(a - b) for a, b in zip(d, ru) if a is not None and b is not None) / umax
    print(f"{st:>8} {'ok':>8} {r['elapsed_s']:7.1f} {r['results']['phases'][-1]['max_disp']:12.6e} {rel:12.2e}")
PY
cat "$LOG" | grep -vE '^wrote'
