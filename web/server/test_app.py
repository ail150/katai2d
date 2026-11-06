import json
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

import app as service

# Tutorial 1 project fixtures used by the server tests. They were moved here from
# web/examples/ when the UI example/preset library was removed (plaxis-parity
# plan Phase 1, decision D1): they are server-test inputs, not shipped UI presets.
FIXTURES = Path(__file__).resolve().parent / "tests" / "fixtures"


def already_meshed_project(name: str) -> dict:
    """A project that already carries the mesh the job endpoint would otherwise build.

    The endpoint guarantees that a calculation runs on the up-to-date PLAXIS mesh, and it
    builds that mesh with gmsh BEFORE it creates the job. That step takes seconds -- longer
    than the fake solver the queue tests use -- so a test waiting for the queue to back up
    would never see a queued job: the first job would already have finished by the time the
    second one was created, and the reuse rule would find nothing active to reuse.

    A project that already carries the mesh skips the step entirely, which is what these
    tests are about: the queue, the reuse rule and the cancellation path, not the mesher.
    The mesh itself is a placeholder -- the fake solver never reads it.

    The two keys the endpoint compares against are the ones it stamps onto the project:
    `explicit_mesh` (present, with elements, of the expected node count) and `mesh_meta`
    (the preset, order, element size and geometry signature the mesh was built for).
    """
    return {
        "katai2d": 29,
        "name": name,
        "explicit_mesh": {
            "node_count": 3, "element_count": 1, "nodes_per_element": 6,
            "x": [0.0, 1.0, 0.0], "y": [0.0, 0.0, 1.0],
            "connectivity": [0, 1, 2], "element_material": [0],
            "boundary_nodes": [0, 1, 2],
        },
        "mesh_meta": {"preset": "Medium", "order": 6, "elem_size": None, "geom_sig": []},
    }


def test_owner_project_mesh_solve_results_and_stale_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    repo = Path(__file__).resolve().parents[2]
    cli = os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai"))
    monkeypatch.setattr(service, "CLI", cli)
    fixture = Path(os.environ.get("KATAI_TEST_PROJECT", str(repo / "tests/corpus/kv-fnd-008-strip-load.k2d")))
    data = json.loads(fixture.read_text(encoding="utf-8"))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        assert client.get("/api/health").status_code == 401
        assert client.get("/api/health", headers=headers).json()["ok"] is True

        imported = client.post("/api/projects/import", content=fixture.read_bytes(), headers=headers)
        assert imported.status_code == 201
        pid = imported.json()["id"]
        assert client.get(f"/api/projects/{pid}", headers=headers).json()["project"]["name"] == data["name"]

        validation = client.post(f"/api/projects/{pid}/validate", headers=headers)
        assert validation.status_code == 200 and validation.json()["ok"] is True
        mesh = client.post(f"/api/projects/{pid}/mesh", headers=headers)
        assert mesh.status_code == 200
        assert mesh.json()["mesh"]["element_count"] > 0

        started = client.post(f"/api/projects/{pid}/jobs", headers=headers)
        assert started.status_code == 202
        jid = started.json()["id"]
        for _ in range(120):
            status = client.get(f"/api/jobs/{jid}", headers=headers).json()
            if status["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.1)
        assert status["status"] == "completed", status
        assert "log" not in status

        results = client.get(f"/api/projects/{pid}/results", headers=headers)
        assert results.status_code == 200
        phase = results.json()["results"]["phases"][-1]
        assert phase["ok"] is True
        assert len(phase["displacement"]) > 0
        assert len(phase["stress"]) > 0

        data["name"] += " edited"
        assert client.put(f"/api/projects/{pid}", json={"project": data}, headers=headers).status_code == 200
        assert client.get(f"/api/projects/{pid}/results", headers=headers).status_code == 409
        assert client.get(f"/api/projects/{pid}/export", headers=headers).status_code == 200
        assert client.delete(f"/api/projects/{pid}", headers=headers).status_code == 204
        assert client.get(f"/api/projects/{pid}", headers=headers).status_code == 404


def test_worker_queue_and_cancellation(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(3)\n", encoding="utf-8")
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    headers = {"Authorization": "Bearer test-owner-secret"}
    # Already meshed, so the endpoint creates the job at once: this test is about the
    # queue, and a gmsh mesh built before the job would let the first job finish before
    # the second one exists (see already_meshed_project).
    project = already_meshed_project("queue fixture")

    with TestClient(service.app) as client:
        first = client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        second = client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        job1 = client.post(f"/api/projects/{first}/jobs", headers=headers).json()["id"]
        job2 = client.post(f"/api/projects/{second}/jobs", headers=headers).json()["id"]
        assert client.get(f"/api/jobs/{job2}", headers=headers).json()["status"] == "queued"
        assert client.delete(f"/api/jobs/{job1}", headers=headers).status_code == 200
        for _ in range(80):
            s1 = client.get(f"/api/jobs/{job1}", headers=headers).json()
            s2 = client.get(f"/api/jobs/{job2}", headers=headers).json()
            if s1["status"] == "cancelled" and s2["status"] == "running":
                break
            time.sleep(0.05)
        assert s1["status"] == "cancelled"
        assert s2["status"] == "running"
        client.delete(f"/api/jobs/{job2}", headers=headers)
        for _ in range(80):
            s2 = client.get(f"/api/jobs/{job2}", headers=headers).json()
            if s2["status"] == "cancelled": break
            time.sleep(0.05)
        assert s2["status"] == "cancelled"


def test_solve_timeout_stops_the_job_and_reports_diagnostics(tmp_path, monkeypatch):
    # A per-job timeout_s shorter than the solver's run must stop it and mark the
    # job "timeout", and the diagnostics endpoint must report the phase it was in
    # and the log tail (plaxis-parity plan Phase 2 / decision D9).
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    # Fake CLI: print a phase line (what the diagnostics parser looks for), then
    # sleep well past the 1 s cap. It ignores SIGTERM briefly so the kill grace
    # path is exercised too.
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text(
        "#!/usr/bin/env python3\n"
        "import sys, time\n"
        "print('phase 1/3: Initial phase', flush=True)\n"
        "print('phase 2/3: Excavation step', flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    # Avoid the mesher: give the project an explicit mesh so start_job skips it.
    project = {"katai2d": 29, "name": "timeout fixture",
               "explicit_mesh": {"node_count": 3, "element_count": 1, "nodes_per_element": 6,
                                 "x": [0, 1, 0], "y": [0, 0, 1], "connectivity": [0, 1, 2],
                                 "element_material": [0], "boundary_nodes": [0, 1, 2]},
               "mesh": {"order": 6, "preset": "Medium", "elem_size": 1}, "polygons": []}
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        pid = client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        job = client.post(f"/api/projects/{pid}/jobs", json={"timeout_s": 1}, headers=headers).json()
        assert job["timeout_s"] == 1
        jid = job["id"]
        for _ in range(200):
            status = client.get(f"/api/jobs/{jid}", headers=headers).json()["status"]
            if status in {"timeout", "completed", "failed", "cancelled"}:
                break
            time.sleep(0.1)
        assert status == "timeout", status

        diag = client.get(f"/api/jobs/{jid}/diagnostics", headers=headers)
        assert diag.status_code == 200
        body = diag.json()
        assert body["status"] == "timeout"
        assert body["timeout_s"] == 1
        # The last "phase i/n" line the solver printed is reported.
        assert body["running_phase"] == {"index": 2, "count": 3, "name": "Excavation step"}
        assert "Excavation step" in body["log_tail"]


def test_default_solve_timeout_is_configurable(tmp_path, monkeypatch):
    # The global default comes from KATAI_SOLVE_TIMEOUT_S; a job with no timeout_s
    # adopts it, and an invalid timeout_s is rejected.
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    monkeypatch.setattr(service, "SOLVE_TIMEOUT_S", 42.0)
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(2)\n", encoding="utf-8")
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    project = {"katai2d": 29, "name": "default timeout",
               "explicit_mesh": {"node_count": 3, "element_count": 1, "nodes_per_element": 6,
                                 "x": [0, 1, 0], "y": [0, 0, 1], "connectivity": [0, 1, 2],
                                 "element_material": [0], "boundary_nodes": [0, 1, 2]},
               "mesh": {"order": 6, "preset": "Medium", "elem_size": 1}, "polygons": []}
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        pid = client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        job = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()
        assert job["timeout_s"] == 42.0
        client.delete(f"/api/jobs/{job['id']}", headers=headers)
        bad = client.post(f"/api/projects/{pid}/jobs", json={"timeout_s": -5}, headers=headers)
        assert bad.status_code == 422


def test_job_status_streams_and_keeps_committed_progress(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text("""#!/usr/bin/env python3
import json, pathlib, sys, time
args = sys.argv
progress = pathlib.Path(args[args.index('--progress') + 1])
monitor = args[args.index('--monitor') + 1]
for n in range(2):
    payload = {'monitor': {'node_index': 4, 'x': 1.0, 'y': 0.5}, 'samples': [
        {'increment': i + 1, 'load_factor': (i + 1) * 0.5, 'displacement': i * 1e-3,
         'sigma_magnitude': 12.0 + i, 'force_error': 1e-5, 'iterations': 3}
        for i in range(n + 1)]}
    tmp = progress.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload))
    tmp.replace(progress)
    time.sleep(0.25)
pathlib.Path(str(progress) + '.monitor-arg').write_text(monitor)
sys.exit(7)
""", encoding="utf-8")
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        project = {"katai2d": 29, "name": "progress fixture", "x_min": 0, "x_max": 4,
                   "y_min": 0, "y_max": 1,
                   "loads": [{"x1": 0, "x2": 1, "y1": 0.5, "y2": 0.5},
                             {"x1": 2, "x2": 4, "y1": 0.5, "y2": 0.5}],
                   "initial": {"load": [0, 1]}}
        pid = client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        outside = client.post(f"/api/projects/{pid}/jobs", json={"monitor": {"x": 5, "y": 0.5}}, headers=headers)
        assert outside.status_code == 422
        started = client.post(f"/api/projects/{pid}/jobs", headers=headers)
        assert started.status_code == 202
        jid = started.json()["id"]
        growing = False
        status = started.json()
        for _ in range(50):
            status = client.get(f"/api/jobs/{jid}", headers=headers).json()
            growing = len(status.get("progress", {}).get("samples", [])) >= 2
            if status["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.05)
        assert growing
        assert status["status"] == "failed"
        assert len(status["progress"]["samples"]) == 2
        progress_path = tmp_path / "projects" / pid / f"{jid}.progress.json"
        assert progress_path.with_suffix(progress_path.suffix + ".monitor-arg").read_text() == "3,0.5"

    service.jobs.clear()
    with TestClient(service.app) as restarted:
        restored = restarted.get(f"/api/jobs/{jid}", headers=headers).json()
        assert restored["status"] == "failed"
        assert len(restored["progress"]["samples"]) == 2


def test_repeated_calculate_reuses_active_project_job(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(1)\n", encoding="utf-8")
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        # Already meshed, so the second request reaches the reuse rule while the first
        # job is still active (see already_meshed_project).
        pid = client.post("/api/projects", json={"project": already_meshed_project("reuse fixture")},
                          headers=headers).json()["id"]
        first = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()
        repeated = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()
        assert repeated["id"] == first["id"]
        assert repeated["status"] in {"queued", "running"}
        client.delete(f"/api/jobs/{first['id']}", headers=headers)


def test_restart_resolves_jobs_left_active_or_cancelling(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    headers = {"Authorization": "Bearer test-owner-secret"}
    (tmp_path / "projects" / ("a" * 32)).mkdir(parents=True)
    (tmp_path / "projects" / ("a" * 32) / "project.k2d").write_text('{"katai2d":29}', encoding="utf-8")
    (tmp_path / "jobs").mkdir()
    states = {
        "b" * 32: "queued",
        "c" * 32: "running",
        "d" * 32: "cancelling",
    }
    for jid, status in states.items():
        (tmp_path / "jobs" / f"{jid}.json").write_text(json.dumps({
            "id": jid, "project_id": "a" * 32, "status": status, "message": "old state"
        }), encoding="utf-8")

    with TestClient(service.app) as client:
        for jid, status in states.items():
            job = client.get(f"/api/jobs/{jid}", headers=headers).json()
            assert job["status"] == ("cancelled" if status == "cancelling" else "interrupted")
            assert job["finished_at"]


def test_completed_project_job_and_results_survive_service_restart(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    repo = Path(__file__).resolve().parents[2]
    cli = os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai"))
    monkeypatch.setattr(service, "CLI", cli)
    project = json.loads((FIXTURES / "tutorial1-rigid.k2d").read_text(encoding="utf-8"))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as first_client:
        pid = first_client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        jid = first_client.post(f"/api/projects/{pid}/jobs", headers=headers).json()["id"]
        for _ in range(180):
            status = first_client.get(f"/api/jobs/{jid}", headers=headers).json()
            if status["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.1)
        assert status["status"] == "completed", status
        assert first_client.get(f"/api/projects/{pid}/results", headers=headers).status_code == 200

    # A new lifespan repopulates job state from disk and reads the saved .res through KATAI again.
    service.jobs.clear()
    with TestClient(service.app) as restarted_client:
        stored = restarted_client.get(f"/api/projects/{pid}", headers=headers).json()["project"]
        # The job endpoint guarantees the solve runs on the up-to-date PLAXIS mesh, and it
        # stamps that mesh onto the project file before the solve. So the saved file carries
        # two keys the in-memory copy does not. Everything else -- the model the user saved
        # -- must come back exactly as it went in.
        assert {k: v for k, v in stored.items() if k not in ("explicit_mesh", "mesh_meta")} == project
        assert stored["explicit_mesh"]["element_count"] > 0
        assert restarted_client.get(f"/api/jobs/{jid}", headers=headers).json()["status"] == "completed"
        restored = restarted_client.get(f"/api/projects/{pid}/results", headers=headers)
        assert restored.status_code == 200
        assert restored.json()["job_id"] == jid
        assert restored.json()["results"]["phases"][-1]["ok"] is True


@pytest.mark.parametrize("filename", ["tutorial1-rigid.k2d", "tutorial1-flexible.k2d"])
def test_tutorial1_variants_calculate_and_return_json(filename, tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    repo = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(service, "CLI", os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai")))
    project_path = FIXTURES / filename
    project = json.loads(project_path.read_text(encoding="utf-8"))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        created = client.post("/api/projects", json={"project": project}, headers=headers)
        assert created.status_code == 201
        pid = created.json()["id"]
        assert client.post(f"/api/projects/{pid}/validate", headers=headers).json()["ok"] is True
        assert client.post(f"/api/projects/{pid}/mesh", headers=headers).json()["mesh"]["element_count"] > 0
        job = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()["id"]
        for _ in range(180):
            status = client.get(f"/api/jobs/{job}", headers=headers).json()
            if status["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.1)
        assert status["status"] == "completed", status
        result_response = client.get(f"/api/projects/{pid}/results", headers=headers)
        assert result_response.status_code == 200
        phases = result_response.json()["results"]["phases"]
        assert len(phases) == 2
        assert all(phase["ok"] for phase in phases)
        assert phases[-1]["load_factor"] == pytest.approx(1.0)
        assert len(phases[-1]["displacement"]) > 0
        if "rigid" in filename:
            final = phases[-1]
            support_force_per_radian = sum(
                final["reaction"][2 * i + 1]
                for i, (x, y) in enumerate(zip(final["mesh"]["x"], final["mesh"]["y"]))
                if abs(y - 4.0) < 1e-8 and x <= 1.000001
            )
            reaction_scale = abs(support_force_per_radian * 2.0 * 3.141592653589793)
            assert reaction_scale == pytest.approx(588.0, rel=0.2)
        else:
            reaction_change = sum(phases[-1]["reaction"][1::2]) - sum(phases[0]["reaction"][1::2])
            reaction_scale = abs(reaction_change * 2.0 * 3.141592653589793)
            assert reaction_scale == pytest.approx(590.0, rel=0.05)


def test_mesh_order_and_size_changes_are_used_by_later_calculations(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    repo = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(service, "CLI", os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai")))
    project = json.loads((FIXTURES / "tutorial1-rigid.k2d").read_text(encoding="utf-8"))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        pid = client.post("/api/projects", json={"project": project}, headers=headers).json()["id"]
        meshes = []
        for order, elem_size in [(6, 1.0), (15, 0.75)]:
            project["mesh"]["order"] = order
            project["mesh"]["elem_size"] = elem_size
            assert client.put(f"/api/projects/{pid}", json={"project": project}, headers=headers).status_code == 200
            preview = client.post(f"/api/projects/{pid}/mesh", headers=headers).json()["mesh"]
            assert preview["nodes_per_element"] == order

            jid = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()["id"]
            for _ in range(180):
                status = client.get(f"/api/jobs/{jid}", headers=headers).json()
                if status["status"] in {"completed", "failed", "cancelled"}:
                    break
                time.sleep(0.1)
            assert status["status"] == "completed", status

            loaded = client.get(f"/api/projects/{pid}/results", headers=headers).json()
            phase = loaded["results"]["phases"][-1]
            assert loaded["job_id"] == jid
            assert phase["mesh"]["nodes_per_element"] == order
            assert phase["mesh"]["node_count"] == preview["node_count"]
            assert phase["mesh"]["element_count"] == preview["element_count"]
            meshes.append((preview["node_count"], preview["element_count"]))

        assert meshes[0] != meshes[1]


def test_validate_endpoint_returns_structured_issues(tmp_path, monkeypatch):
    # The validate endpoint returns structured issues (severity, path, message,
    # source) so the UI can link each to its field (plaxis-parity Phase 4).
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKENS", ["test-owner-secret"])
    repo = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(service, "CLI", os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai")))
    good = json.loads((FIXTURES / "tutorial1-rigid.k2d").read_text(encoding="utf-8"))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        # A valid project validates with no issues.
        pid = client.post("/api/projects", json={"project": good}, headers=headers).json()["id"]
        ok = client.post(f"/api/projects/{pid}/validate", headers=headers).json()
        assert ok["ok"] is True
        assert ok["errors"] == 0
        assert ok["issues"] == []

        # A broken project: Rinter out of range and an unknown phase type.
        bad = json.loads((FIXTURES / "tutorial1-rigid.k2d").read_text(encoding="utf-8"))
        bad["materials"][0]["rinter_rigid"] = False
        bad["materials"][0]["Rinter"] = 5
        bad["phases"][0]["type"] = 9
        bpid = client.post("/api/projects", json={"project": bad}, headers=headers).json()["id"]
        res = client.post(f"/api/projects/{bpid}/validate", headers=headers).json()
        assert res["ok"] is False
        assert res["errors"] >= 2
        paths = {iss["path"] for iss in res["issues"]}
        assert "materials[0].Rinter" in paths
        assert "phases[0].type" in paths
        for iss in res["issues"]:
            assert iss["severity"] in {"error", "warning"}
            assert iss["message"]
            assert iss["source"] in {"reader", "validator"}
