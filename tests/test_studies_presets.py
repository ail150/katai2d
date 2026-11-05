import json
from pathlib import Path
import subprocess

EXPECTED_FILES = [
    "study-circular-footing.k2d",
    "study-wall-benchmark.k2d",
    "study-slope-convergence.k2d",
    "study-design-ec7.k2d",
    "study-foundation-sand.k2d",
    "study-lbb-undrained.k2d",
    "test-tunnel-ring.k2d",
    "test-anchor-retension.k2d",
]

def test_studies_presets_exist_and_validate():
    repo_root = Path(__file__).resolve().parent.parent
    studies_dir = repo_root / "tests" / "studies"
    assert studies_dir.is_dir(), f"Studies directory {studies_dir} does not exist"

    found_files = [p.name for p in studies_dir.glob("*.k2d")]
    for expected in EXPECTED_FILES:
        assert expected in found_files, f"Missing preset {expected} in {studies_dir}"

    schema_file = repo_root / "docs" / "k2d.schema.json"
    assert schema_file.is_file(), f"Missing schema file {schema_file}"
    schema = json.loads(schema_file.read_text(encoding="utf-8"))

    for expected in EXPECTED_FILES:
        filepath = studies_dir / expected
        content = json.loads(filepath.read_text(encoding="utf-8"))
        assert content.get("katai2d") == 29, f"{expected}: katai2d format version must be 29"
        assert "name" in content, f"{expected}: missing name"
        assert len(content.get("materials", [])) >= 1, f"{expected}: must have at least 1 material"
        assert "initial" in content, f"{expected}: must have initial phase"

    import platform
    is_win = platform.system() == "Windows"
    wsl_cli = "/mnt/c/Users/THIN 15 RYZEN/Documents/FEM/katai2d/build/ubuntu-24.04/bin/katai"
    for expected in EXPECTED_FILES:
        wsl_path = f"/mnt/c/Users/THIN 15 RYZEN/Documents/FEM/katai2d/tests/studies/{expected}"
        cmd = ["wsl", wsl_cli, "validate", wsl_path] if is_win else [wsl_cli, "validate", wsl_path]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        assert proc.returncode == 0, f"KATAI CLI validation failed for {expected}:\n{proc.stdout}\n{proc.stderr}"

if __name__ == "__main__":
    test_studies_presets_exist_and_validate()
    print("ALL STUDY PRESETS VALIDATED SUCCESSFULLY")

