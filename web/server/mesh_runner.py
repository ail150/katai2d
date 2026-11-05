import multiprocessing as mp
import sys
from typing import Any, Dict

def _worker(project_data: Dict[str, Any], model_name: str, preset: str, order: int, target_size: float | None, conn) -> None:
    try:
        from plaxis_style_mesher import PlaxisStyleMesher
        mesher = PlaxisStyleMesher.from_project(project_data, model_name=model_name)
        res = mesher.generate_mesh(preset=preset, element_order=order, show_gui=False, target_element_size=target_size)
        conn.send({"ok": True, "res": res})
    except Exception as e:
        conn.send({"ok": False, "error": str(e)})
    finally:
        conn.close()

def run_mesh_isolated(project_data: Dict[str, Any], model_name: str, preset: str, order: int, target_size: float | None = None, timeout: float = 120.0) -> Dict[str, Any]:
    ctx = mp.get_context("spawn")
    parent_conn, child_conn = ctx.Pipe()
    p = ctx.Process(target=_worker, args=(project_data, model_name, preset, order, target_size, child_conn))
    p.start()
    child_conn.close()

    if parent_conn.poll(timeout):
        out = parent_conn.recv()
    else:
        p.terminate()
        p.join(2)
        raise TimeoutError(f"Mesh generation timed out after {timeout} seconds")
    
    p.join(5)
    if p.is_alive():
        p.kill()
        
    if not out.get("ok"):
        raise RuntimeError(out.get("error", "Mesh generation failed"))
    return out["res"]

