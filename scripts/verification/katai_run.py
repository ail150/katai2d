#!/usr/bin/env python3
"""Thin wrapper to solve a .k2d through the katai CLI with a wall-clock timeout.

Keeps the WSL/Windows path juggling in one place. The CLI is invoked as:
    katai solve  <k2d> --out <res> [--timings]
    katai results <k2d> <res>            -> JSON on stdout

On Windows the native binary lives under build/ubuntu-24.04 and must run through
WSL; on Linux it runs directly. KATAI_CLI overrides the binary path.

Verdicts returned by solve_and_read():
    {"status": "ok"|"timeout"|"solve_failed"|"read_failed", "elapsed_s": float,
     "results": <parsed json or None>, "stdout": str, "stderr": str, "rc": int}
"""
from __future__ import annotations

import json
import os
import platform
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
# Prefer the PARDISO build (CMake preset ubuntu-24.04-mkl) when it exists: same
# answers as the Eigen build to the phase tolerance (scripts/verification/
# compare_backends.py) and up to ~2x faster on nonlinear models with structures.
# KATAI_CLI always overrides (ctest sets it to the build under test).
_MKL_CLI = REPO_ROOT / "build" / "ubuntu-24.04-mkl" / "bin" / "katai"
_EIGEN_CLI = REPO_ROOT / "build" / "ubuntu-24.04" / "bin" / "katai"
DEFAULT_LINUX_CLI = _MKL_CLI if _MKL_CLI.exists() else _EIGEN_CLI
IS_WINDOWS = platform.system() == "Windows"


def _to_wsl_path(p: Path) -> str:
    s = str(p)
    if len(s) > 1 and s[1] == ":":
        drive = s[0].lower()
        rest = s[2:].replace("\\", "/")
        return f"/mnt/{drive}{rest}"
    return s.replace("\\", "/")


def _cli_base():
    """Return (argv_prefix, path_mapper) for invoking katai."""
    cli = os.environ.get("KATAI_CLI")
    if IS_WINDOWS:
        # Run the Linux binary through WSL. Paths must be /mnt/... form.
        binary = cli or _to_wsl_path(DEFAULT_LINUX_CLI)
        return (["wsl", "-e", binary], _to_wsl_path)
    binary = cli or str(DEFAULT_LINUX_CLI)
    return ([binary], lambda p: str(p))


def solve_and_read(k2d_path: Path, timeout_s: float = 300.0, timings: bool = False):
    prefix, mapp = _cli_base()
    res_path = k2d_path.with_suffix(".res")
    k2d_arg = mapp(k2d_path)
    res_arg = mapp(res_path)

    solve_cmd = prefix + ["solve", k2d_arg, "--out", res_arg]
    if timings:
        solve_cmd.append("--timings")

    t0 = time.time()
    try:
        sp = subprocess.run(solve_cmd, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired as e:
        return {
            "status": "timeout", "elapsed_s": time.time() - t0, "results": None,
            "stdout": (e.stdout or "") if isinstance(e.stdout, str) else "",
            "stderr": (e.stderr or "") if isinstance(e.stderr, str) else "",
            "rc": None,
        }
    elapsed = time.time() - t0
    if sp.returncode != 0:
        return {
            "status": "solve_failed", "elapsed_s": elapsed, "results": None,
            "stdout": sp.stdout, "stderr": sp.stderr, "rc": sp.returncode,
        }

    read_cmd = prefix + ["results", k2d_arg, res_arg]
    rp = subprocess.run(read_cmd, capture_output=True, text=True, timeout=120)
    if rp.returncode != 0:
        return {
            "status": "read_failed", "elapsed_s": elapsed, "results": None,
            "stdout": rp.stdout, "stderr": rp.stderr, "rc": rp.returncode,
        }
    try:
        results = json.loads(rp.stdout)
    except json.JSONDecodeError as e:
        return {
            "status": "read_failed", "elapsed_s": elapsed, "results": None,
            "stdout": rp.stdout, "stderr": f"json: {e}", "rc": 0,
        }
    return {
        "status": "ok", "elapsed_s": elapsed, "results": results,
        "stdout": sp.stdout, "stderr": sp.stderr, "rc": 0,
    }
