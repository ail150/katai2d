import json
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

import app as service


def test_owner_project_mesh_solve_results_and_stale_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
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
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(3)\n", encoding="utf-8")
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    headers = {"Authorization": "Bearer test-owner-secret"}
    project = {"katai2d": 29, "name": "queue fixture"}

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


def test_job_status_streams_and_keeps_committed_progress(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
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
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
    fake_cli = tmp_path / "fake-katai"
    fake_cli.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(1)\n", encoding="utf-8")
    fake_cli.chmod(0o755)
    monkeypatch.setattr(service, "CLI", str(fake_cli))
    headers = {"Authorization": "Bearer test-owner-secret"}

    with TestClient(service.app) as client:
        pid = client.post("/api/projects", json={"project": {"katai2d": 29}}, headers=headers).json()["id"]
        first = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()
        repeated = client.post(f"/api/projects/{pid}/jobs", headers=headers).json()
        assert repeated["id"] == first["id"]
        assert repeated["status"] in {"queued", "running"}
        client.delete(f"/api/jobs/{first['id']}", headers=headers)


def test_restart_resolves_jobs_left_active_or_cancelling(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
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
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
    repo = Path(__file__).resolve().parents[2]
    cli = os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai"))
    monkeypatch.setattr(service, "CLI", cli)
    project = json.loads((repo / "web/examples/tutorial1-rigid.k2d").read_text(encoding="utf-8"))
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
        assert restarted_client.get(f"/api/projects/{pid}", headers=headers).json()["project"] == project
        assert restarted_client.get(f"/api/jobs/{jid}", headers=headers).json()["status"] == "completed"
        restored = restarted_client.get(f"/api/projects/{pid}/results", headers=headers)
        assert restored.status_code == 200
        assert restored.json()["job_id"] == jid
        assert restored.json()["results"]["phases"][-1]["ok"] is True


@pytest.mark.parametrize("filename", ["tutorial1-rigid.k2d", "tutorial1-flexible.k2d"])
def test_tutorial1_variants_calculate_and_return_json(filename, tmp_path, monkeypatch):
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
    repo = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(service, "CLI", os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai")))
    project_path = repo / "web" / "examples" / filename
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
    monkeypatch.setattr(service, "TOKEN", "test-owner-secret")
    repo = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(service, "CLI", os.environ.get("KATAI_CLI", str(repo / "build/ubuntu-24.04/bin/katai")))
    project = json.loads((repo / "web/examples/tutorial1-rigid.k2d").read_text(encoding="utf-8"))
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
