// katai -- the command-line front end (layer 4, a composition root). It programs
// against the published facade exclusively, and every solve goes through
// katai::api::Job -- the SAME layer-2 work the GUI's solve button submits, so the
// front end cannot change the answer. tests/test_cli.cpp pins that across processes:
// the .res this program writes is bit-identical to an in-process Job run.
//
// Subcommands:
//   katai solve <file.k2d> [--out <file.res>]   run every phase; progress on stderr
//   katai validate <file.k2d>                    print the input-contract report
//   katai info                                   the file-format versions this build speaks
//
// Exit codes (documented here, pinned by test_cli):
//   0  success (validate: no errors; solve: every phase converged)
//   2  usage error
//   3  a file cannot be read, parsed or written
//   4  the input contract refused the project: validation errors, or reader ERROR
//      notes (a forward-version file whose enums this build had to clamp) -- the
//      reader-notes rule: display may proceed, a solve must not
//   5  the solve failed (a phase did not converge or the engine refused it)

#include <katai/api/katai.hpp>

#include <cstdio>
#include <cstring>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <optional>
#include <sstream>
#include <string>
#include <type_traits>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace api = katai::api;

namespace {

bool any_error_note(const std::vector<api::Issue>& notes);
int load(const std::string& path, api::Project& pr, std::vector<api::Issue>& notes);

int usage() {
    std::fprintf(stderr,
                 "katai -- KATAI 2D command line\n"
                 "usage:\n"
                 "  katai solve <file.k2d> [--out <file.res>] [--timings] [--progress <file.json>] [--monitor X,Y]\n"
                 "  katai mesh <file.k2d>\n"
                 "  katai results <file.k2d> <file.res>\n"
                 "  katai validate <file.k2d>\n"
                 "  katai info\n"
                 "exit codes: 0 ok, 2 usage, 3 file error, 4 input contract refused, "
                 "5 solve failed\n");
    return 2;
}

void json_string(const std::string& s) {
    std::cout << '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"': std::cout << "\\\""; break;
            case '\\': std::cout << "\\\\"; break;
            case '\b': std::cout << "\\b"; break;
            case '\f': std::cout << "\\f"; break;
            case '\n': std::cout << "\\n"; break;
            case '\r': std::cout << "\\r"; break;
            case '\t': std::cout << "\\t"; break;
            default:
                if (c < 0x20) std::cout << "\\u00" << std::hex << std::setw(2)
                                         << std::setfill('0') << int(c) << std::dec;
                else std::cout << char(c);
        }
    }
    std::cout << '"';
}

template<class T> void json_array(const std::vector<T>& values) {
    std::cout << '[';
    bool first = true;
    for (const auto& v : values) {
        if (!first) std::cout << ',';
        first = false;
        if constexpr (std::is_floating_point_v<T>) {
            if (std::isfinite(v)) std::cout << v; else std::cout << "null";
        } else if constexpr (std::is_same_v<T, char> || std::is_same_v<T, signed char> ||
                             std::is_same_v<T, unsigned char>) std::cout << int(v);
        else std::cout << v;
    }
    std::cout << ']';
}

void json_number(double value) {
    if (std::isfinite(value)) std::cout << value;
    else std::cout << "null";
}

void json_eigen(const Eigen::VectorXd& values) {
    std::cout << '[';
    for (Eigen::Index i = 0; i < values.size(); ++i) {
        if (i) std::cout << ',';
        const double v = values[i];
        if (std::isfinite(v)) std::cout << v; else std::cout << "null";
    }
    std::cout << ']';
}

void json_mesh(const katai::mesh::Mesh& m) {
    std::cout << "{\"node_count\":" << m.node_count << ",\"element_count\":" << m.element_count
              << ",\"nodes_per_element\":" << m.nodes_per_element << ",\"x\":";
    json_array(m.x); std::cout << ",\"y\":"; json_array(m.y);
    std::cout << ",\"connectivity\":"; json_array(m.connectivity);
    std::cout << ",\"element_material\":"; json_array(m.element_material);
    std::cout << ",\"boundary_nodes\":"; json_array(m.boundary_nodes);
    std::cout << '}';
}

int cmd_mesh(const std::string& path) {
    api::Project pr;
    std::vector<api::Issue> notes;
    if (const int rc = load(path, pr, notes)) return rc;
    const auto report = api::validate_project(pr);
    if (!report.ok() || any_error_note(notes)) {
        std::fputs(report.to_string().c_str(), stdout);
        return 4;
    }
    if (pr.explicit_mesh.has_value() && pr.explicit_mesh->element_count > 0) {
        std::cout << std::setprecision(17)
                  << "{\"quality_met\":true,\"min_angle_asked\":20,\"corner_elements\":0,\"mesh\":";
        json_mesh(*pr.explicit_mesh);
        std::cout << "}\n";
        return 0;
    }
    const auto generated = katai::app::mesh_from_project(pr);
    if (!generated.ok) {
        std::fprintf(stderr, "error: mesh generation failed: %s\n", generated.message.c_str());
        return 5;
    }
    std::cout << std::setprecision(17)
              << "{\"quality_met\":" << (generated.quality_met ? "true" : "false")
              << ",\"min_angle_asked\":" << generated.min_angle_asked
              << ",\"corner_elements\":" << generated.corner_elements << ",\"mesh\":";
    json_mesh(generated.mesh);
    std::cout << "}\n";
    return 0;
}

void json_results(const std::vector<api::SolveResult>& phases, const api::Project& project) {
    std::cout << std::setprecision(17) << "{\"phases\":[";
    for (size_t i = 0; i < phases.size(); ++i) {
        if (i) std::cout << ',';
        const auto& r = phases[i];
        std::cout << "{\"index\":" << i << ",\"name\":";
        json_string(i == 0 ? project.initial.name
                            : (i - 1 < project.phases.size() ? project.phases[i - 1].name
                                                            : std::string("Phase ") + std::to_string(i + 1)));
        std::cout << ",\"ok\":" << (r.ok ? "true" : "false") << ",\"message\":";
        json_string(r.message);
        std::cout << ",\"max_disp\":"; json_number(r.max_disp);
        std::cout << ",\"load_factor\":"; json_number(r.load_factor);
        std::cout << ",\"fos\":"; json_number(r.fos);
        std::cout << ",\"fos_lower_bound\":" << (r.fos_lower_bound ? "true" : "false")
                  << ",\"iterations\":" << r.iterations << ",\"mesh\":";
        json_mesh(r.mesh);
        std::cout << ",\"displacement\":"; json_eigen(r.disp);
        std::cout << ",\"displacement_total\":"; json_eigen(r.disp_total);
        std::cout << ",\"stress\":[";
        for (size_t n = 0; n < r.stress.stress.size(); ++n) {
            if (n) std::cout << ',';
            const auto& s = r.stress.stress[n];
            std::cout << '['; json_number(s[0]); std::cout << ','; json_number(s[1]);
            std::cout << ','; json_number(s[2]); std::cout << ']';
        }
        std::cout << "],\"pore\":"; json_array(r.pore);
        std::cout << ",\"flow_head\":"; json_array(r.flow_head);
        std::cout << ",\"flow_head_transient\":" << (r.flow_head_transient ? "true" : "false")
                  << ",\"excess_pore\":"; json_array(r.excess_pore);
        std::cout << ",\"saturation\":"; json_array(r.saturation);
        std::cout << ",\"consol_time\":"; json_array(r.consol_time);
        std::cout << ",\"consol_settlement\":"; json_array(r.consol_settlement);
        std::cout << ",\"consol_excess_pore\":"; json_array(r.consol_excess_pore);
        std::cout << ",\"consol_stop\":" << static_cast<int>(r.consol_stop)
                  << ",\"consol_stop_met\":" << (r.consol_stop_met ? "true" : "false")
                  << ",\"consol_pore_reference\":";
        json_number(r.consol_pore_reference);
        std::cout << ",\"consol_degree_reached\":"; json_number(r.consol_degree_reached);
        std::cout
                  << ",\"reaction\":"; json_eigen(r.reaction);
        std::cout << ",\"active\":"; json_array(r.active);
        std::cout << ",\"nil_step\":" << (r.nil_step ? "true" : "false")
                  << ",\"design_approach\":" << static_cast<int>(r.design_approach)
                  << ",\"dyn_time\":"; json_array(r.dyn_time);
        std::cout << ",\"dyn_surface_ax\":"; json_array(r.dyn_surface_ax);
        std::cout << ",\"dyn_period\":"; json_array(r.dyn_period);
        std::cout << ",\"dyn_response_sa\":"; json_array(r.dyn_response_sa);
        std::cout << ",\"dyn_design_sa\":"; json_array(r.dyn_design_sa);
        std::cout << ",\"dyn_design_sa_ec8\":"; json_array(r.dyn_design_sa_ec8);
        std::cout << ",\"dyn_peak_surface_a\":"; json_number(r.dyn_peak_surface_a);
        std::cout << ",\"dyn_model_f1\":"; json_number(r.dyn_model_f1);
        std::cout << ",\"struct_forces\":[";
        for (size_t si = 0; si < r.struct_forces.size(); ++si) {
            if (si) std::cout << ',';
            const auto& f = r.struct_forces[si];
            std::cout << "{\"name\":"; json_string(f.name);
            std::cout << ",\"kind\":" << f.kind << ",\"yielded\":" << (f.yielded ? "true" : "false")
                      << ",\"max_N\":"; json_number(f.max_N);
            std::cout << ",\"max_Q\":"; json_number(f.max_Q);
            std::cout << ",\"max_M\":"; json_number(f.max_M);
            std::cout << ",\"stations\":[";
            for (size_t j = 0; j < f.stations.size(); ++j) {
                if (j) std::cout << ',';
                const auto& s = f.stations[j];
                std::cout << '['; json_number(s.s); std::cout << ','; json_number(s.x);
                std::cout << ','; json_number(s.y); std::cout << ','; json_number(s.N);
                std::cout << ','; json_number(s.Q); std::cout << ','; json_number(s.M);
                std::cout << ','; json_number(s.ux); std::cout << ','; json_number(s.uy);
                std::cout << ']';
            }
            std::cout << "]}";
        }
        std::cout << "],\"interface_forces\":[";
        for (size_t si = 0; si < r.interface_forces.size(); ++si) {
            if (si) std::cout << ',';
            const auto& f = r.interface_forces[si];
            std::cout << "{\"name\":"; json_string(f.name);
            std::cout << ",\"max_abs_tau\":"; json_number(f.max_abs_tau);
            std::cout << ",\"max_abs_sigma_n\":"; json_number(f.max_abs_sigma_n);
            std::cout << ",\"max_abs_slip\":"; json_number(f.max_abs_slip);
            std::cout << ",\"any_slip\":" << (f.any_slip ? "true" : "false") << ",\"stations\":[";
            for (size_t j = 0; j < f.stations.size(); ++j) {
                if (j) std::cout << ',';
                const auto& s = f.stations[j];
                std::cout << '['; json_number(s.s); std::cout << ','; json_number(s.x);
                std::cout << ','; json_number(s.y); std::cout << ','; json_number(s.tau);
                std::cout << ','; json_number(s.sigma_n); std::cout << ','; json_number(s.slip);
                std::cout << ','; json_number(s.gap); std::cout << ']';
            }
            std::cout << "]}";
        }
        std::cout << "],\"diagnostics\":[";
        for (size_t di = 0; di < r.diagnostics.size(); ++di) {
            if (di) std::cout << ',';
            const auto& d = r.diagnostics[di];
            std::cout << "{\"severity\":"; json_string(d.severity == api::DiagnosticSeverity::Refusal ? "refusal" : d.severity == api::DiagnosticSeverity::Warning ? "warning" : "note");
            std::cout << ",\"code\":"; json_string(d.code); std::cout << ",\"subject\":"; json_string(d.subject);
            std::cout << ",\"message\":"; json_string(d.message); std::cout << '}';
        }
        std::cout << "]}";
    }
    std::cout << "]}\n";
}

int cmd_results(const std::string& project_path, const std::string& results_path) {
    api::Project pr;
    std::vector<api::Issue> notes;
    if (const int rc = load(project_path, pr, notes)) return rc;
    std::vector<api::SolveResult> phases;
    std::string err;
    const auto hash = api::fnv1a64(api::project_to_json(pr));
    if (!api::load_results(results_path, hash, phases, &err)) {
        std::fprintf(stderr, "error: cannot read results %s: %s\n", results_path.c_str(), err.c_str());
        return err.find("stale") != std::string::npos ? 4 : 3;
    }
    json_results(phases, pr);
    return 0;
}

void print_issues(const std::vector<api::Issue>& issues) {
    for (const api::Issue& i : issues)
        std::printf("%s: %s: %s\n",
                    i.severity == api::Severity::Error ? "error" : "warning",
                    i.path.c_str(), i.message.c_str());
}

// What the run did that the file does not literally say: a line clipped to the soil, a
// fallback taken, an object refused. The input contract is checked before a mesh exists,
// so these are the only report a user gets on everything that is decided against the mesh
// -- printing them is what keeps a discarded load from passing as a clean run.
void print_diagnostics(const api::SolveResult& R) {
    for (const api::Diagnostic& d : R.diagnostics) {
        const char* sev = d.severity == api::DiagnosticSeverity::Refusal  ? "refusal"
                        : d.severity == api::DiagnosticSeverity::Warning  ? "warning"
                                                                          : "note   ";
        std::printf("  %s %s  %s%s%s\n", sev, d.code.c_str(),
                    d.subject.empty() ? "" : d.subject.c_str(), d.subject.empty() ? "" : ": ",
                    d.message.c_str());
    }
}

// WHICH convergence criteria the phase met. "ok" on its own is a claim about one quantity --
// the out-of-balance force -- and a run can satisfy that while individual stress points still
// carry stresses their own material law would not return for the strains they were given. The
// force residual cannot see that, because it is assembled FROM those stresses.
//
// Printed for every phase that measured it, so the accuracy the numbers were accepted under
// travels with them; the second block appears only when there is something to act on.
//
// The first line leads with the ratio the step STOPPED on, against the tolerance it was held to.
// The stiffness-weighted force error follows on its own line, labelled for what it is: a stricter
// reading reported beside the test, not the test. Printed as "the force error" it read as a
// thousandfold miss on a converged phase (KV-STR-005: 1.763e-07 against 1.000e-10, while the
// ratio it stopped on was 1.763e-13).
void print_convergence(const api::SolveResult& R) {
    const auto& c = R.convergence;
    if (!c.measured) return;
    std::printf("  converged: force error %.3e of %.3e tolerated", c.global_error, c.tolerated);
    if (c.plastic_points > 0 || c.nl_elastic_points > 0)
        std::printf(", stiffness parameter %.3f", c.csp);
    if (c.has_moment) std::printf(", moment error %.3e", c.moment_error);
    std::printf("\n");
    std::printf("             stiffness-weighted force error %.3e (reported, not the stopping "
                "test)\n", c.force_error);
    if (!c.plastic_points_ok())
        std::printf("  note    %d of %d yielding stress points carry a LOCAL error above the "
                    "same tolerance (worst %.2e).\n"
                    "          The force balance is met; the stresses at those points are not "
                    "yet the ones\n"
                    "          the material law returns for their strains. Tighten the phase's "
                    "tolerated error to close it.\n",
                    c.plastic_inaccurate, c.plastic_points, c.worst_plastic_error);
    if (!c.nl_elastic_ok())
        std::printf("  note    %d of %d stress points whose stiffness varies with stress carry a "
                    "LOCAL error above\n"
                    "          the same tolerance (worst %.2e).\n",
                    c.nl_elastic_inaccurate, c.nl_elastic_points, c.worst_nl_elastic_error);
    if (!c.iface_points_ok())
        std::printf("  note    %d of %d slipping interface points carry a LOCAL error above the "
                    "same tolerance\n"
                    "          (worst %.2e). The shear those points transfer is not yet settled.\n",
                    c.iface_inaccurate, c.iface_points, c.worst_iface_error);
    if (!c.foot_ok())
        std::printf("  note    the embedded-beam foot force is out of balance by %.2e, above the "
                    "%.2e allowed\n"
                    "          for it. The load the pile toe carries is not yet settled.\n",
                    c.foot_force_error, c.kFootToleranceFactor * c.tolerated);
}

bool any_error_note(const std::vector<api::Issue>& notes) {
    for (const api::Issue& i : notes)
        if (i.severity == api::Severity::Error) return true;
    return false;
}

// Load + surface the reader's forward-version notes. Returns 0, or the exit code.
int load(const std::string& path, api::Project& pr, std::vector<api::Issue>& notes) {
    std::string err;
    if (!api::load_project(path, pr, &err, &notes)) {
        std::fprintf(stderr, "error: cannot read %s: %s\n", path.c_str(), err.c_str());
        return 3;
    }
    print_issues(notes);
    return 0;
}

int cmd_validate(const std::string& path) {
    api::Project pr;
    std::vector<api::Issue> notes;
    if (const int rc = load(path, pr, notes)) return rc;
    const api::ValidationReport rep = api::validate_project(pr);
    std::fputs(rep.to_string().c_str(), stdout);
    if (!rep.ok() || any_error_note(notes)) {
        std::printf("REFUSED: the project fails the input contract (%d error(s), %d warning(s))\n",
                    rep.errors, rep.warnings);
        return 4;
    }
    std::printf("OK: %s satisfies the input contract (%d warning(s))\n", path.c_str(),
                rep.warnings);
    return 0;
}

std::string json_quote(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char c : value) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: if (c >= 0x20) out << static_cast<char>(c);
        }
    }
    out << '"';
    return out.str();
}

bool write_progress_snapshot(const std::string& path,
                             const std::vector<api::IncrementSample>& samples) {
    if (path.empty()) return true;
    const std::filesystem::path target(path);
    const std::filesystem::path temporary = target.string() + ".tmp";
    std::ofstream f(temporary, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    f << std::setprecision(17) << "{\"monitor\":";
    if (samples.empty()) f << "null";
    else {
        const auto& s = samples.back();
        f << "{\"node_index\":" << s.node_index << ",\"x\":" << s.x << ",\"y\":" << s.y << '}';
    }
    f << ",\"samples\":[";
    for (size_t i = 0; i < samples.size(); ++i) {
        if (i) f << ',';
        const auto& s = samples[i];
        f << "{\"phase_index\":" << s.phase_index << ",\"phase_name\":"
          << json_quote(s.phase_name) << ",\"increment\":" << s.increment
          << ",\"load_factor\":" << s.load_factor << ",\"node_index\":" << s.node_index
          << ",\"x\":" << s.x << ",\"y\":" << s.y
          << ",\"displacement\":" << s.displacement
          << ",\"sigma_magnitude\":" << s.sigma_magnitude
          << ",\"force_error\":" << s.force_error << ",\"iterations\":" << s.iterations << '}';
    }
    f << "]}\n";
    f.close();
    if (!f) { std::filesystem::remove(temporary); return false; }
#ifdef _WIN32
    if (!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        std::filesystem::remove(temporary);
        return false;
    }
#else
    std::error_code ec;
    std::filesystem::rename(temporary, target, ec);
    if (ec) { std::filesystem::remove(temporary); return false; }
#endif
    return true;
}

int cmd_solve(const std::string& path, const std::string& out, bool timings,
              const std::string& progress_path, const std::optional<std::pair<double, double>>& monitor) {
    api::Project pr;
    std::vector<api::Issue> notes;
    if (const int rc = load(path, pr, notes)) return rc;
    if (any_error_note(notes)) {
        std::printf("REFUSED: the file carries reader ERROR notes (see above); "
                    "a solve must not proceed on clamped input\n");
        return 4;
    }

    api::Job job(pr);
    if (monitor) job.set_monitor_point(monitor->first, monitor->second);
    std::vector<api::IncrementSample> samples;
    bool progress_write_failed = false;
    if (!progress_path.empty()) {
        job.set_on_increment([&](const api::IncrementSample& sample) {
            samples.push_back(sample);
            if (!write_progress_snapshot(progress_path, samples)) progress_write_failed = true;
        });
    }
    job.set_on_phase([](int cur, int total, const std::string& name) {
        std::fprintf(stderr, "phase %d/%d: %s\n", cur + 1, total, name.c_str());
    });
    if (!job.run()) {
        if (progress_write_failed) std::fprintf(stderr, "error: cannot write progress file %s\n", progress_path.c_str());
        if (!job.report().ok()) {
            std::fputs(job.report().to_string().c_str(), stdout);
            std::printf("REFUSED: %s\n", job.message().c_str());
            return 4;
        }
        // Every phase that ran, including the one that stopped the job: its diagnostics name
        // the object at fault, so they must survive the failure path.
        const std::vector<api::SolveResult>& partial = job.results();
        for (size_t i = 0; i < partial.size(); ++i) {
            if (partial[i].diagnostics.empty()) continue;
            std::printf("phase %zu:\n", i + 1);
            print_diagnostics(partial[i]);
        }
        if (!out.empty() && !partial.empty()) {
            std::string err;
            const std::uint64_t hash = api::fnv1a64(api::project_to_json(pr));
            if (!api::save_results(out, hash, partial, &err)) {
                std::fprintf(stderr, "warning: cannot write partial results %s: %s\n", out.c_str(), err.c_str());
            }
        }
        std::printf("FAILED: %s\n", job.message().c_str());
        return 5;
    }
    if (progress_write_failed) {
        std::fprintf(stderr, "error: cannot write progress file %s\n", progress_path.c_str());
        return 3;
    }

    const std::vector<api::SolveResult>& res = job.results();
    double total_s = 0.0;
    for (const api::PhaseTiming& t : job.timings()) total_s += t.seconds;
    for (size_t i = 0; i < res.size(); ++i) {
        const api::SolveResult& R = res[i];
        std::printf("phase %zu/%zu: ok  max|u| = %.6e m", i + 1, res.size(), R.max_disp);
        if (R.fos >= 0.0)
            std::printf("  FoS %s %.3f", R.fos_lower_bound ? ">" : "=", R.fos);
        std::printf("\n");
        print_convergence(R);
        // Where the time went (--timings): the phase's wall clock, and inside its main Newton
        // solve the tangent assemblies (the constitutive integration happens there), the
        // residual-only assemblies of the line search, the sparse matrix compile and the
        // linear solves, and the increments it took. A Safety phase's breakdown is the
        // continuation that found its factor; a coupled phase aggregates many solves and prints
        // only its wall clock.
        if (timings) {
            const auto& T = R.timings;
            const double wall = i < job.timings().size() ? job.timings()[i].seconds : 0.0;
            std::printf("  time    %.2f s", wall);
            if (T.total > 0.0)
                std::printf(" -- solve %.2f s: tangent %d x %.2f s, residual %d x %.2f s, "
                            "matrix %.2f s, linear %d x %.2f s, %d steps",
                            T.total, T.n_tangent, T.assemble_tangent, T.n_residual,
                            T.assemble_residual, T.csr_build, T.n_solve, T.linear_solve, T.n_steps);
            std::printf("\n");
        }
        print_diagnostics(R);
    }
    std::printf("solved %zu phase(s) in %.2f s\n", res.size(), total_s);

    if (!out.empty()) {
        std::string err;
        const std::uint64_t hash = api::fnv1a64(api::project_to_json(pr));
        if (!api::save_results(out, hash, res, &err)) {
            std::fprintf(stderr, "error: cannot write %s: %s\n", out.c_str(), err.c_str());
            return 3;
        }
        std::printf("results written to %s\n", out.c_str());
    }
    return 0;
}

int cmd_info() {
    std::printf("%s %s (%s)\n", api::kAppName, api::kVersion, api::kVersionDate);
    std::printf("  .k2d project file version: %d\n", api::kProjectFileVersion);
    std::printf("  .res results file version: %u\n", (unsigned)api::kResultsFileVersion);
    std::printf("  linear solver backend: %s\n", api::backend_name());
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
    // The process code page is UTF-8 (cmake/utf8.manifest); so is what this program prints.
    SetConsoleOutputCP(CP_UTF8);
#endif
    if (argc < 2) return usage();
    const std::string cmd = argv[1];
    if (cmd == "info") return argc == 2 ? cmd_info() : usage();
    if (cmd == "validate") return argc == 3 ? cmd_validate(argv[2]) : usage();
    if (cmd == "mesh") return argc == 3 ? cmd_mesh(argv[2]) : usage();
    if (cmd == "results") return argc == 4 ? cmd_results(argv[2], argv[3]) : usage();
    if (cmd == "solve") {
        std::string file, out, progress;
        std::optional<std::pair<double, double>> monitor;
        bool timings = false;
        for (int i = 2; i < argc; ++i) {
            if (std::strcmp(argv[i], "--out") == 0 && i + 1 < argc) out = argv[++i];
            else if (std::strcmp(argv[i], "--progress") == 0 && i + 1 < argc) progress = argv[++i];
            else if (std::strcmp(argv[i], "--monitor") == 0 && i + 1 < argc) {
                std::string point = argv[++i];
                const auto comma = point.find(',');
                if (comma == std::string::npos) return usage();
                try {
                    const double x = std::stod(point.substr(0, comma));
                    const double y = std::stod(point.substr(comma + 1));
                    if (!std::isfinite(x) || !std::isfinite(y)) return usage();
                    monitor = std::pair{x, y};
                } catch (...) { return usage(); }
            }
            else if (std::strcmp(argv[i], "--timings") == 0) timings = true;
            else if (argv[i][0] == '-' || !file.empty()) return usage();
            else file = argv[i];
        }
        return file.empty() ? usage() : cmd_solve(file, out, timings, progress, monitor);
    }
    return usage();
}
