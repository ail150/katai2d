"""``katai`` from pip -- the same command line as the native executable.

Installed as a console script by the wheel, this module mirrors ``cli/main.cpp``:
the same five commands (``solve``, ``mesh``, ``results``, ``validate``, ``info``),
the same flags, and the SAME exit codes (0 ok, 2 usage, 3 file error, 4 input
contract refused, 5 solve failed) -- scripts written against one front end must not
break on the other. Anything that holds here is pinned by the wheel build's
verification step.

The parity is the point, so it is worth saying what it costs: every command here
goes through the same published facade (``katai::api``) as the native binary, so
the two cannot drift in what they compute. What they CAN drift in is the printed
form, and that is why the JSON shapes below are written out by hand rather than
shared -- the native binary prints with ``std::cout`` because it has no runtime
to hand, and a front end that consumed its stdout would have to parse it. The
commands, the flags and the exit codes are the contract; the wording of a line is
not.

What this module deliberately does NOT do is shell out to the native binary.
Doing so would make the wheel a thin wrapper around an executable it may not
carry, and would put a second implementation of the same command tree in the
tree -- the thing the parity is meant to prevent.
"""
import json
import math
import os
import sys

from . import _core


# ------------------------------------------------------------------ helpers --

def _print_issues(issues):
    for i in issues:
        sev = "error" if i.severity == _core.Severity.Error else "warning"
        print(f"{sev}: {i.path}: {i.message}")


def _any_error_note(notes):
    return any(i.severity == _core.Severity.Error for i in notes)


def _print_diagnostics(result):
    """What the run did that the file does not literally say: a line clipped to
    the soil, a fallback taken, an object refused. The input contract is checked
    before a mesh exists, so this is the only report on everything decided
    against the mesh -- printing it is what keeps a discarded load from passing
    as a clean run."""
    for d in result.diagnostics:
        sev = ("refusal" if d.severity == _core.DiagnosticSeverity.Refusal else
               "warning" if d.severity == _core.DiagnosticSeverity.Warning else "note   ")
        subject = f"{d.subject}: " if d.subject else ""
        print(f"  {sev} {d.code}  {subject}{d.message}")


def _num(value):
    """A JSON number, with the same convention as the native binary: a value
    that is not finite is `null`, never NaN or Infinity (which are not JSON)."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _numlist(values):
    return [_num(v) for v in values]


def _usage():
    sys.stderr.write(
        "katai -- KATAI 2D command line\n"
        "usage:\n"
        "  katai solve <file.k2d> [--out <file.res>] [--timings] [--progress <file.json>] [--monitor X,Y]\n"
        "  katai mesh <file.k2d>\n"
        "  katai results <file.k2d> <file.res>\n"
        "  katai validate <file.k2d> [--json]\n"
        "  katai info\n"
        "exit codes: 0 ok, 2 usage, 3 file error, 4 input contract refused, "
        "5 solve failed\n")
    return 2


def _load(path):
    """Load + surface the reader's forward-version notes. Returns (project,
    notes, 0) or (None, None, exit_code)."""
    try:
        pr, notes = _core.load_project(path)
    except ValueError as e:
        sys.stderr.write(f"error: {e}\n")
        return None, None, 3
    _print_issues(notes)
    return pr, notes, 0


def _model_hash(pr):
    """The staleness stamp a .res carries: the hash of the project it was
    computed for. The same fnv1a64 over the same canonical JSON in every front
    end, so a file written by one is readable by the others."""
    return _core.fnv1a64(_core.project_to_json(pr))


# ----------------------------------------------------------------- validate --

def _cmd_validate(path):
    pr, notes, rc = _load(path)
    if rc:
        return rc
    rep = _core.validate_project(pr)
    sys.stdout.write(str(rep))
    if not rep.ok() or _any_error_note(notes):
        print(f"REFUSED: the project fails the input contract "
              f"({rep.errors} error(s), {rep.warnings} warning(s))")
        return 4
    print(f"OK: {path} satisfies the input contract ({rep.warnings} warning(s))")
    return 0


def _cmd_validate_json(path):
    """The structured form: every issue as {severity, path, message, source} so a
    front end can map a field path like "materials[2].Rf" back to the field that
    owns it. The exit code is the same contract as the text form: 0 ok, 3 file
    error, 4 refused."""
    try:
        pr, notes = _core.load_project(path)
    except ValueError as e:
        print(json.dumps({"ok": False, "readable": False, "error": str(e), "issues": []}))
        return 3
    rep = _core.validate_project(pr)
    errors, warnings = rep.errors, rep.warnings
    issues = []
    for n in notes:
        is_error = n.severity == _core.Severity.Error
        issues.append({"severity": "error" if is_error else "warning",
                       "path": n.path, "message": n.message, "source": "reader"})
        if is_error:
            errors += 1
        else:
            warnings += 1
    for i in rep.issues:
        issues.append({"severity": "error" if i.severity == _core.Severity.Error else "warning",
                       "path": i.path, "message": i.message, "source": "validator"})
    ok = rep.ok() and not _any_error_note(notes)
    print(json.dumps({"ok": ok, "readable": True, "errors": errors,
                      "warnings": warnings, "issues": issues}))
    return 0 if ok else 4


# --------------------------------------------------------------------- mesh --

def _mesh_json(mesh):
    return {
        "node_count": mesh.node_count,
        "element_count": mesh.element_count,
        "nodes_per_element": mesh.nodes_per_element,
        "x": _numlist(mesh.x),
        "y": _numlist(mesh.y),
        "connectivity": list(mesh.connectivity),
        "element_material": list(mesh.element_material),
        "boundary_nodes": list(mesh.boundary_nodes),
    }


def _cmd_mesh(path):
    pr, notes, rc = _load(path)
    if rc:
        return rc
    rep = _core.validate_project(pr)
    if not rep.ok() or _any_error_note(notes):
        sys.stdout.write(str(rep))
        return 4
    try:
        generated = _core.mesh_from_project(pr)
    except ValueError as e:
        sys.stderr.write(f"error: mesh generation failed: {e}\n")
        return 5
    print(json.dumps({"quality_met": bool(generated.quality_met),
                      "min_angle_asked": _num(generated.min_angle_asked),
                      "corner_elements": generated.corner_elements,
                      "mesh": _mesh_json(generated.mesh)}))
    return 0


# ------------------------------------------------------------------ results --

def _phase_json(result, index, name):
    return {
        "index": index,
        "name": name,
        "ok": bool(result.ok),
        "message": result.message,
        "max_disp": _num(result.max_disp),
        "load_factor": _num(result.load_factor),
        "fos": _num(result.fos),
        "fos_lower_bound": bool(result.fos_is_lower_bound),
        "displacement": _numlist(result.displacement),
        "displacement_total": _numlist(result.displacement_total),
        "stress": [[_num(c) for c in row] for row in result.stress],
        "pore": _numlist(result.pore),
        "reaction": _numlist(result.reaction),
        "excess_pore": _numlist(result.excess_pore),
        "consol_time": _numlist(result.consol_time),
        "consol_settlement": _numlist(result.consol_settlement),
        "consol_excess_pore": _numlist(result.consol_excess_pore),
        "consol_stop": int(result.consol_stop),
        "consol_stop_met": bool(result.consol_stop_met),
        "consol_pore_reference": _num(result.consol_pore_reference),
        "consol_degree_reached": _num(result.consol_degree_reached),
        "struct_forces": [
            {"name": f.name, "kind": int(f.kind), "yielded": bool(f.yielded),
             "max_N": _num(f.max_N), "max_Q": _num(f.max_Q), "max_M": _num(f.max_M),
             "stations": [[_num(s.s), _num(s.x), _num(s.y), _num(s.N), _num(s.Q),
                           _num(s.M), _num(s.ux), _num(s.uy)] for s in f.stations]}
            for f in result.struct_forces
        ],
        "interface_forces": [
            {"name": f.name, "max_abs_tau": _num(f.max_abs_tau),
             "max_abs_sigma_n": _num(f.max_abs_sigma_n),
             "max_abs_slip": _num(f.max_abs_slip), "any_slip": bool(f.any_slip),
             "stations": [[_num(s.s), _num(s.x), _num(s.y), _num(s.tau),
                           _num(s.sigma_n), _num(s.slip)] for s in f.stations]}
            for f in result.interface_forces
        ],
        "diagnostics": [
            {"severity": int(d.severity), "code": d.code, "subject": d.subject,
             "message": d.message}
            for d in result.diagnostics
        ],
    }


def _cmd_results(project_path, results_path):
    pr, notes, rc = _load(project_path)
    if rc:
        return rc
    try:
        phases = _core.load_results(results_path, _model_hash(pr))
    except ValueError as e:
        sys.stderr.write(f"error: {e}\n")
        return 3
    names = [pr.initial.name] + [p.name for p in pr.phases]
    out = {"phases": [_phase_json(r, i, names[i] if i < len(names) else f"Phase {i + 1}")
                      for i, r in enumerate(phases)]}
    print(json.dumps(out))
    return 0


# -------------------------------------------------------------------- solve --

def _write_progress(path, monitor, samples):
    """The progress snapshot, written whole or not at all: a reader either sees
    a complete file or the previous one. The native binary writes it the same
    way (temporary file, then an atomic replace), because a reader that catches
    a half-written file sees a truncated run."""
    payload = {
        "monitor": ({"node_index": monitor["node_index"], "x": _num(monitor["x"]),
                      "y": _num(monitor["y"])} if monitor else None),
        "samples": samples,
    }
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(payload, f)
        f.write("\n")
    os.replace(temporary, path)


def _cmd_solve(path, out, timings=False, progress_path=None, monitor=None):
    pr, notes, rc = _load(path)
    if rc:
        return rc
    if _any_error_note(notes):
        print("REFUSED: the file carries reader ERROR notes (see above); "
              "a solve must not proceed on clamped input")
        return 4

    job = _core.Job(pr)
    job.set_on_phase(lambda cur, total, name:
                     sys.stderr.write(f"phase {cur + 1}/{total}: {name}\n"))

    samples = []
    monitor_point = {"node_index": None, "x": None, "y": None}

    if monitor is not None:
        job.set_monitor_point(monitor[0], monitor[1])

        def on_increment(sample):
            monitor_point["node_index"] = sample.node_index
            monitor_point["x"] = sample.x
            monitor_point["y"] = sample.y
            samples.append({
                "phase_index": sample.phase_index, "phase_name": sample.phase_name,
                "increment": sample.increment, "load_factor": _num(sample.load_factor),
                "node_index": sample.node_index, "x": _num(sample.x), "y": _num(sample.y),
                "displacement": _num(sample.displacement),
                "sigma_magnitude": _num(sample.sigma_magnitude),
                "force_error": _num(sample.force_error), "iterations": sample.iterations,
            })
            if progress_path:
                _write_progress(progress_path, monitor_point, samples)

        job.set_on_increment(on_increment)

    if not job.run():
        if progress_path:
            try:
                _write_progress(progress_path, monitor_point, samples)
            except OSError as e:
                sys.stderr.write(f"error: cannot write progress file {progress_path}: {e}\n")
                return 3
        if not job.report().ok():
            sys.stdout.write(str(job.report()))
            print(f"REFUSED: {job.message()}")
            return 4
        # Every phase that ran, including the one that stopped the job: its
        # diagnostics name the object at fault, so they survive the failure path.
        for i, r in enumerate(job.results()):
            if r.diagnostics:
                print(f"phase {i + 1}:")
                _print_diagnostics(r)
        # The partial results are still worth having: they say how far the run got.
        if out and job.results():
            try:
                _core.save_results(out, _model_hash(pr), job.results())
            except ValueError as e:
                sys.stderr.write(f"warning: cannot write partial results {out}: {e}\n")
        print(f"FAILED: {job.message()}")
        return 5

    res = job.results()
    total_s = sum(t.seconds for t in job.timings())
    for i, r in enumerate(res):
        line = f"phase {i + 1}/{len(res)}: ok  max|u| = {r.max_disp:.6e} m"
        if r.fos >= 0.0:
            line += f"  FoS {'>' if r.fos_is_lower_bound else '='} {r.fos:.3f}"
        print(line)
        if timings:
            wall = job.timings()[i].seconds if i < len(job.timings()) else 0.0
            print(f"  time    {wall:.2f} s")
        _print_diagnostics(r)
    print(f"solved {len(res)} phase(s) in {total_s:.2f} s")

    if out:
        try:
            _core.save_results(out, _model_hash(pr), res)
        except ValueError as e:
            sys.stderr.write(f"error: {e}\n")
            return 3
        print(f"results written to {out}")
    return 0


# --------------------------------------------------------------------- info --

def _cmd_info():
    print(f"KATAI 2D {_core.__version__} ({_core.__version_date__})")
    print(f"  .k2d project file version: {_core.PROJECT_FILE_VERSION}")
    print(f"  .res results file version: {_core.RESULTS_FILE_VERSION}")
    print(f"  linear solver backend: {_core.backend_name()}")
    return 0


# --------------------------------------------------------------------- main --

def _parse_solve(argv):
    """The solve flags, parsed the way the native binary parses them: an
    unknown flag or a second file is a usage error, not something to guess
    about."""
    file, out, progress = "", "", ""
    timings = False
    monitor = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out" and i + 1 < len(argv):
            out = argv[i + 1]; i += 2
        elif a == "--progress" and i + 1 < len(argv):
            progress = argv[i + 1]; i += 2
        elif a == "--monitor" and i + 1 < len(argv):
            point = argv[i + 1]; i += 2
            comma = point.find(",")
            if comma < 0:
                return None
            try:
                x = float(point[:comma]); y = float(point[comma + 1:])
            except ValueError:
                return None
            if not (math.isfinite(x) and math.isfinite(y)):
                return None
            monitor = (x, y)
        elif a == "--timings":
            timings = True; i += 1
        elif a.startswith("-") or file:
            return None
        else:
            file = a; i += 1
    if not file:
        return None
    return file, out, timings, progress, monitor


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    if not argv:
        return _usage()
    cmd = argv[0]
    if cmd == "info":
        return _cmd_info() if len(argv) == 1 else _usage()
    if cmd == "validate":
        if len(argv) == 2:
            return _cmd_validate(argv[1])
        if len(argv) == 3 and argv[1] == "--json":
            return _cmd_validate_json(argv[2])
        if len(argv) == 3 and argv[2] == "--json":
            return _cmd_validate_json(argv[1])
        return _usage()
    if cmd == "mesh":
        return _cmd_mesh(argv[1]) if len(argv) == 2 else _usage()
    if cmd == "results":
        return _cmd_results(argv[1], argv[2]) if len(argv) == 3 else _usage()
    if cmd == "solve":
        parsed = _parse_solve(argv[1:])
        if parsed is None:
            return _usage()
        return _cmd_solve(*parsed)
    return _usage()


if __name__ == "__main__":
    raise SystemExit(main())
