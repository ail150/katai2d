"""Static contract for the supported Ubuntu build entry point."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LinuxBuildConfigTests(unittest.TestCase):
    def test_ubuntu_preset_uses_portable_solver_and_python_bindings(self):
        presets = json.loads((ROOT / "CMakePresets.json").read_text(encoding="utf-8"))
        preset = next(p for p in presets["configurePresets"] if p["name"] == "ubuntu-24.04")
        build_preset = next(p for p in presets["buildPresets"] if p["name"] == "ubuntu-24.04")

        self.assertEqual(preset["generator"], "Ninja")
        self.assertIn("ubuntu-24.04", preset["binaryDir"])
        self.assertEqual(build_preset["configurePreset"], "ubuntu-24.04")
        variables = preset["cacheVariables"]
        self.assertEqual(variables["KATAI_WITH_MKL"], "OFF")
        self.assertEqual(variables["KATAI_WITH_CLI"], "ON")
        self.assertEqual(variables["KATAI_WITH_PYTHON"], "ON")
        self.assertEqual(variables["KATAI_WITH_TESTS"], "ON")

    def test_linux_build_script_and_ci_use_the_supported_preset(self):
        script = ROOT / "scripts" / "build-linux.sh"
        workflow = ROOT / ".github" / "workflows" / "ci-linux.yml"

        self.assertTrue(script.is_file())
        self.assertIn("ubuntu-24.04", script.read_text(encoding="utf-8"))
        self.assertTrue(workflow.is_file())
        ci = workflow.read_text(encoding="utf-8")
        self.assertIn("runs-on: ubuntu-24.04", ci)
        self.assertIn("build-linux.sh", ci)


if __name__ == "__main__":
    unittest.main()
