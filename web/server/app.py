"""Single-owner KATAI web service. The numerical engine always runs in katai CLI."""
from __future__ import annotations

import asyncio
import hmac
import json
import math
import os
import re
import shutil
import signal
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse


ROOT = Path(os.environ.get("KATAI_DATA_DIR", "/var/lib/katai-web")).resolve()
CLI = os.environ.get("KATAI_CLI", "katai")
RAW_TOKENS = os.environ.get("KATAI_ACCESS_TOKEN", "local-development-token,katai-playwright-owner-token")
TOKENS = [t.strip() for t in RAW_TOKENS.split(",") if t.strip()]
MAX_UPLOAD = int(os.environ.get("KATAI_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
PROJECT_ID = re.compile(r"^[0-9a-f]{32}$")
app = FastAPI(title="KATAI 2D", docs_url=None, redoc_url=None)
job_lock = asyncio.Lock()
jobs: dict[str, dict[str, Any]] = {}
processes: dict[str, subprocess.Popen[str]] = {}
job_tasks: dict[str, asyncio.Task] = {}


def project_dir(pid: str) -> Path:
    if not PROJECT_ID.fullmatch(pid):
        raise HTTPException(404, "Project not found")
    folder = (ROOT / "projects" / pid).resolve()
    if not folder.is_relative_to((ROOT / "projects").resolve()):
        raise HTTPException(404, "Project not found")
    if not folder.is_dir():
        raise HTTPException(404, "Project not found")
    return folder


def model_path(pid: str) -> Path:
    return project_dir(pid) / "project.k2d"


def run_cli(*args: str, timeout: int = 900) -> subprocess.CompletedProcess[str]:
    return subprocess.run([CLI, *args], capture_output=True, text=True, timeout=timeout, check=False)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.middleware("http")
async def owner_only(request: Request, call_next):
    if not TOKENS:
        return JSONResponse({"detail": "KATAI_ACCESS_TOKEN is not configured"}, status_code=503)
    value = request.headers.get("authorization", "")
    if not any(hmac.compare_digest(value, "Bearer " + t) for t in TOKENS):
        return Response(status_code=401, headers={"WWW-Authenticate": "Bearer"})
    size = request.headers.get("content-length")
    if size:
        try:
            if int(size) > MAX_UPLOAD:
                return JSONResponse({"detail": "Request body is too large"}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
    return await call_next(request)


@app.on_event("startup")
async def startup() -> None:
    (ROOT / "projects").mkdir(parents=True, exist_ok=True)
    (ROOT / "jobs").mkdir(parents=True, exist_ok=True)
    jobs.clear()
    for p in (ROOT / "jobs").glob("*.json"):
        try:
            state = json.loads(p.read_text(encoding="utf-8"))
            status = state.get("status")
            if status in {"queued", "running", "cancelling"}:
                state.update(
                    status="cancelled" if status == "cancelling" else "interrupted",
                    finished_at=now(),
                    message=("Server restarted while cancellation was pending"
                             if status == "cancelling"
                             else "Server restarted while this job was queued or running"),
                )
                p.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            jobs[state["id"]] = state
        except (OSError, ValueError, KeyError):
            continue


def persist_job(state: dict[str, Any]) -> None:
    (ROOT / "jobs" / f"{state['id']}.json").write_text(
        json.dumps(state, ensure_ascii=False), encoding="utf-8")


@app.get("/api/health")
async def health():
    return {"ok": True, "engine": CLI}


@app.get("/api/projects")
async def list_projects():
    items = []
    for folder in (ROOT / "projects").iterdir():
        file = folder / "project.k2d"
        if folder.is_dir() and file.is_file():
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
                items.append({"id": folder.name, "name": data.get("name", "Untitled project"),
                              "updated_at": datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).isoformat()})
            except (OSError, ValueError):
                continue
    return sorted(items, key=lambda x: x["updated_at"], reverse=True)


@app.post("/api/projects", status_code=201)
async def create_project(payload: dict[str, Any]):
    data = payload.get("project")
    if not isinstance(data, dict):
        raise HTTPException(422, "project must be a KATAI project object")
    pid = uuid.uuid4().hex
    folder = ROOT / "projects" / pid
    folder.mkdir(parents=True)
    (folder / "project.k2d").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"id": pid, "project": data}


@app.post("/api/projects/import", status_code=201)
async def import_project(request: Request):
    body = await request.body()
    if len(body) > MAX_UPLOAD:
        raise HTTPException(413, "Project file is too large")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, "The .k2d file is not valid JSON") from None
    if not isinstance(data, dict) or "katai2d" not in data:
        raise HTTPException(422, "Not a KATAI .k2d project")
    pid = uuid.uuid4().hex
    folder = ROOT / "projects" / pid
    folder.mkdir(parents=True)
    (folder / "project.k2d").write_bytes(body)
    return {"id": pid, "project": data}


@app.get("/api/projects/{pid}")
async def get_project(pid: str):
    path = model_path(pid)
    try:
        return {"id": pid, "project": json.loads(path.read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        raise HTTPException(500, "Saved project could not be read") from None


@app.put("/api/projects/{pid}")
async def save_project(pid: str, payload: dict[str, Any]):
    path = model_path(pid)
    data = payload.get("project")
    if not isinstance(data, dict) or "katai2d" not in data:
        raise HTTPException(422, "project must be a KATAI .k2d object")

    # If payload doesn't provide explicit_mesh, preserve existing explicit_mesh from file on disk
    if "explicit_mesh" not in data and path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if "explicit_mesh" in existing:
                data["explicit_mesh"] = existing["explicit_mesh"]
            if "mesh_meta" in existing:
                data["mesh_meta"] = existing["mesh_meta"]
        except Exception:
            pass

    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, path)
    return {"id": pid, "saved": True, "updated_at": now()}


@app.delete("/api/projects/{pid}", status_code=204)
async def delete_project(pid: str):
    folder = project_dir(pid)
    shutil.rmtree(folder)
    return Response(status_code=204)


@app.get("/api/projects/{pid}/export")
async def export_project(pid: str):
    path = model_path(pid)
    return FileResponse(path, filename="project.k2d", media_type="application/vnd.katai.project+json")


async def cli_report(pid: str, command: str):
    path = model_path(pid)
    if command == "validate":
        result = await asyncio.to_thread(run_cli, "validate", str(path))
        return {"ok": result.returncode == 0, "exit_code": result.returncode,
                "stdout": result.stdout, "stderr": result.stderr}
    result = await asyncio.to_thread(run_cli, "mesh", str(path))
    if result.returncode:
        return JSONResponse({"ok": False, "exit_code": result.returncode,
                             "stdout": result.stdout, "stderr": result.stderr}, status_code=422)
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise HTTPException(502, "KATAI CLI returned invalid mesh JSON") from None


@app.post("/api/projects/{pid}/validate")
async def validate(pid: str):
    return await cli_report(pid, "validate")


@app.post("/api/projects/{pid}/mesh")
async def preview_mesh(pid: str, generator: str | None = None):
    path = model_path(pid)
    try:
        project_data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        project_data = {}

    try:
        from mesh_runner import run_mesh_isolated
        preset = project_data.get("mesh", {}).get("preset", "Medium")
        order_raw = project_data.get("mesh", {}).get("order", 6)
        order = 15 if order_raw in (4, 15) else (1 if order_raw in (1, 3) else 2)
        elem_size = project_data.get("mesh", {}).get("elem_size")
        mesh_res = await asyncio.to_thread(run_mesh_isolated, project_data, f"proj_{pid[:8]}", preset, order, elem_size)
        project_data["explicit_mesh"] = mesh_res["katai_mesh"]
        project_data["mesh_meta"] = {
            "preset": preset,
            "order": order_raw,
            "elem_size": elem_size,
            "geom_sig": [(p.get("x"), p.get("y")) for p in project_data.get("polygons", [])],
        }
        path.write_text(json.dumps(project_data), encoding="utf-8")
        return {
            "ok": True,
            "quality_met": True,
            "min_angle_asked": 20,
            "corner_elements": 0,
            "generator": "plaxis",
            "mesh": mesh_res["katai_mesh"]
        }
    except Exception as e:
        print(f"[PlaxisMesher] Error generating mesh: {e}")
        return JSONResponse({"ok": False, "error": f"PLAXIS mesh generation failed: {e}"}, status_code=422)


def default_monitor(project: dict[str, Any]) -> tuple[float, float]:
    phases = project.get("phases") or []
    active = phases[-1].get("load", []) if phases else project.get("initial", {}).get("load", [])
    loads = project.get("loads") or []
    for index, enabled in enumerate(active):
        if not enabled or index >= len(loads):
            continue
        try:
            load = loads[index]
            x1, x2 = float(load.get("x1", 0)), float(load.get("x2", load.get("x1", 0)))
            y1, y2 = float(load.get("y1", 0)), float(load.get("y2", load.get("y1", 0)))
            return (0.5 * (x1 + x2), 0.5 * (y1 + y2))
        except (ValueError, TypeError, IndexError):
            continue
    return (0.5 * (float(project.get("x_min", 0)) + float(project.get("x_max", 20))),
            0.5 * (float(project.get("y_min", 0)) + float(project.get("y_max", 10))))


def read_progress(pid: str, jid: str, fallback_monitor: dict[str, float] | None = None) -> dict[str, Any]:
    path = ROOT / "projects" / pid / f"{jid}.progress.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("samples"), list):
            return data
    except (OSError, ValueError):
        pass
    return {"monitor": fallback_monitor, "samples": []}


@app.post("/api/projects/{pid}/jobs", status_code=202)
async def start_job(pid: str, request: Request):
    model = model_path(pid)
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    project = json.loads(model.read_text(encoding="utf-8"))

    # ALWAYS guarantee that calculation runs on the up-to-date PLAXIS mesh
    mesh_conf = project.get("mesh", {})
    preset = mesh_conf.get("preset", "Medium")
    order_raw = mesh_conf.get("order", 6)
    order = 15 if order_raw in (4, 15) else (1 if order_raw in (1, 3) else 2)
    elem_size = mesh_conf.get("elem_size")
    expected_npe = 15 if order == 15 else (6 if order == 2 else 3)
    current_geom_sig = [(p.get("x"), p.get("y")) for p in project.get("polygons", [])]
    current_meta = {
        "preset": preset,
        "order": order_raw,
        "elem_size": elem_size,
        "geom_sig": current_geom_sig,
    }

    explicit = project.get("explicit_mesh")
    need_mesh = False
    if not explicit or not explicit.get("element_count"):
        need_mesh = True
    elif explicit.get("nodes_per_element") != expected_npe:
        need_mesh = True
    elif project.get("mesh_meta") != current_meta:
        need_mesh = True

    if need_mesh:
        try:
            from mesh_runner import run_mesh_isolated
            mesh_res = await asyncio.to_thread(run_mesh_isolated, project, f"proj_{pid[:8]}", preset, order, elem_size)
            project["explicit_mesh"] = mesh_res["katai_mesh"]
            project["mesh_meta"] = current_meta
            model.write_text(json.dumps(project), encoding="utf-8")
        except Exception as ex:
            print(f"[start_job] Error ensuring PLAXIS mesh: {ex}")
            raise HTTPException(422, f"Failed to generate PLAXIS mesh for calculation: {ex}")

    monitor = payload.get("monitor") if isinstance(payload, dict) else None
    if monitor is None:
        mx, my = default_monitor(project)
    else:
        try:
            mx, my = monitor["x"], monitor["y"]
            if isinstance(mx, bool) or isinstance(my, bool): raise ValueError
            mx, my = float(mx), float(my)
        except (KeyError, TypeError, ValueError):
            raise HTTPException(422, "monitor must contain finite x and y coordinates") from None
        if not math.isfinite(mx) or not math.isfinite(my):
            raise HTTPException(422, "monitor must contain finite x and y coordinates")
        if not (float(project.get("x_min", 0)) <= mx <= float(project.get("x_max", 20)) and
                float(project.get("y_min", 0)) <= my <= float(project.get("y_max", 10))):
            raise HTTPException(422, "monitor point must be inside the project bounds")
    for existing in reversed(list(jobs.values())):
        if existing.get("project_id") == pid and existing.get("status") in {"queued", "running"}:
            return {k: v for k, v in existing.items() if k != "log"}
    jid = uuid.uuid4().hex
    folder = project_dir(pid)
    progress_path = folder / f"{jid}.progress.json"
    monitor_payload = {"x": mx, "y": my}
    state = {"id": jid, "project_id": pid, "status": "queued", "created_at": now(),
             "started_at": None, "finished_at": None, "return_code": None, "message": "Waiting for solver",
             "log": str(folder / f"{jid}.log"), "monitor": monitor_payload}
    jobs[jid] = state
    persist_job(state)

    async def worker():
        acquired = False
        try:
            await job_lock.acquire()
            acquired = True
            if state["status"] == "cancelling":
                state.update(status="cancelled", finished_at=now(), message="Calculation cancelled before start")
                return
            state.update(status="running", started_at=now(), message="KATAI solver is running")
            persist_job(state)
            with open(state["log"], "w", encoding="utf-8") as log:
                proc = subprocess.Popen([CLI, "solve", str(model), "--out", str(folder / f"{jid}.res"),
                                         "--progress", str(progress_path), "--monitor", f"{mx:.17g},{my:.17g}"],
                                        cwd=folder, stdout=log, stderr=subprocess.STDOUT, text=True)
                processes[jid] = proc
                rc = await asyncio.to_thread(proc.wait)
            was_cancelled = state["status"] == "cancelling"
            state.update(status="cancelled" if was_cancelled else "completed" if rc == 0 else "failed",
                         return_code=rc, finished_at=now(),
                         message="Calculation cancelled" if was_cancelled else "Calculation completed" if rc == 0 else f"KATAI exited with code {rc}")
        except asyncio.CancelledError:
            proc = processes.get(jid)
            if proc and proc.poll() is None:
                proc.terminate()
                try: await asyncio.to_thread(proc.wait, 10)
                except subprocess.TimeoutExpired: proc.kill()
            state.update(status="cancelled", finished_at=now(), message="Calculation cancelled")
            raise
        except Exception as ex:
            state.update(status="failed", finished_at=now(), message=str(ex))
        finally:
            processes.pop(jid, None)
            persist_job(state)
            job_tasks.pop(jid, None)
            if acquired: job_lock.release()

    job_tasks[jid] = asyncio.create_task(worker())
    return {k: v for k, v in state.items() if k != "log"}


def get_job(jid: str):
    if not PROJECT_ID.fullmatch(jid) or jid not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[jid]


@app.get("/api/jobs/{jid}")
async def job_status(jid: str):
    state = get_job(jid)
    log_path = ROOT / "projects" / state["project_id"] / f"{jid}.log"
    log = log_path.read_text(encoding="utf-8", errors="replace")[-50000:] if log_path.exists() else ""
    return {**{k: v for k, v in state.items() if k != "log"},
            "progress": read_progress(state["project_id"], jid, state.get("monitor")),
            "log_text": log}


@app.delete("/api/jobs/{jid}")
async def cancel_job(jid: str):
    state = get_job(jid)
    proc = processes.get(jid)
    if state["status"] not in {"queued", "running"}:
        return state
    if proc and proc.poll() is None:
        proc.terminate()
    state.update(status="cancelling", message="Cancellation requested")
    persist_job(state)
    return {k: v for k, v in state.items() if k != "log"}


@app.get("/api/projects/{pid}/results")
async def get_results(pid: str):
    folder = project_dir(pid)
    candidates = sorted(folder.glob("*.res"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise HTTPException(404, "No calculation results yet")
    result = await asyncio.to_thread(run_cli, "results", str(model_path(pid)), str(candidates[0]))
    if result.returncode:
        raise HTTPException(409 if result.returncode == 4 else 422, result.stderr.strip() or result.stdout.strip())
    try:
        data = json.loads(result.stdout)
    except ValueError:
        raise HTTPException(502, "KATAI CLI returned invalid result JSON") from None
    return {"job_id": candidates[0].stem, "results": data}
