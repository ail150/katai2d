// The katai command line pinned end to end, with the corpus as its test set:
//
//   (1) EXIT CODES -- the documented contract (0 ok / 2 usage / 3 file error /
//       4 input contract refused / 5 solve failed) probed case by case.
//   (2) THE CORPUS RUNS THROUGH THE CLI ALONE -- `katai validate` accepts every
//       checked-in case, and `katai solve` runs a single-phase and a staged case
//       (the Stage C gate's "reproducible from the file" now holds from a shell).
//   (3) REFUSAL AT THE FIELD PATH -- an invalid project is refused by the CLI with
//       the validator's message reaching stdout verbatim.
//   (4) CROSS-PROCESS IDENTICAL RESULT -- `katai solve --out` writes a .res in a
//       SEPARATE PROCESS; loading it back and comparing against an in-process
//       api::Job run of the same file is BIT-identical. With test_jobs (Job ==
//       driver) and the GUI submitting the same Job, the "front end cannot change
//       the answer" gate now spans all three front ends.
//
// verify: none -- front-end mechanics (exit codes, refusal plumbing, file
// round-trip); the physics numbers behind the runs are declared by the corpus
// cases and asserted in test_input_corpus.
#include <katai/api/katai.hpp>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#ifndef _WIN32
#include <sys/wait.h>
#endif

namespace api = katai::api;

namespace {
int g_failures = 0;
void check(bool ok, const char* what) {
    std::printf(ok ? "ok:   %s\n" : "FAIL: %s\n", what);
    if (!ok) ++g_failures;
}

std::string cli_exe() {
#ifdef _WIN32
    return std::string(KATAI_BIN_DIR) + "/katai.exe";
#else
    return std::string(KATAI_BIN_DIR) + "/katai";
#endif
}

// Run the CLI in a child process; return its exit code, optionally capturing
// stdout+stderr. The whole command line is wrapped in one extra pair of quotes
// because cmd.exe strips the outermost pair.
int run_cli(const std::string& args, const std::string& capture = {}) {
    std::string cmd = "\"" + cli_exe() + "\" " + args;
    if (!capture.empty()) cmd += " > \"" + capture + "\" 2>&1";
#ifdef _WIN32
    cmd = "\"" + cmd + "\"";
#endif
    const int status = std::system(cmd.c_str());
#ifdef _WIN32
    return status;
#else
    if (status == -1) return status;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return 128 + WTERMSIG(status);
#endif
}

std::string slurp(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

std::string corpus(const char* file) { return std::string(KATAI_CORPUS_DIR) + "/" + file; }

void test_usage_and_info() {
    std::printf("-- usage + info --\n");
    check(run_cli("") == 2, "no arguments -> exit 2 (usage)");
    check(run_cli("frobnicate") == 2, "unknown subcommand -> exit 2");
    check(run_cli("solve") == 2, "solve without a file -> exit 2");
    check(run_cli("info", "cli_info.txt") == 0, "info -> exit 0");
    const std::string info = slurp("cli_info.txt");
    check(info.find(".k2d project file version") != std::string::npos,
          "info states the file-format versions");
    check(info.find(katai::api::kVersion) != std::string::npos,
          "info states the program version (the ONE identity)");
    std::remove("cli_info.txt");
}

void test_validate_corpus() {
    std::printf("-- the whole corpus validates through the CLI --\n");
    const char* cases[] = {
        "kv-con-002-terzaghi-column.k2d", "kv-fnd-008-strip-load.k2d",
        "kv-fnd-009-flamant-line-load.k2d", "kv-num-003-k0-geostatic-block.k2d",
        "kv-cst-001-undrained-column.k2d", "kv-slp-001-griffiths-lane-slope.k2d",
        "kv-exc-001-staged-excavation.k2d",
    };
    for (const char* c : cases)
        check(run_cli("validate \"" + corpus(c) + "\"") == 0,
              (std::string("katai validate accepts ") + c).c_str());
}

void test_mesh_json() {
    std::printf("-- standalone mesh preview as JSON --\n");
    const std::string file = corpus("kv-fnd-008-strip-load.k2d");
    check(run_cli("mesh \"" + file + "\"", "cli_mesh.json") == 0,
          "katai mesh generates a preview without solving");
    const std::string json = slurp("cli_mesh.json");
    check(json.find("\"node_count\"") != std::string::npos,
          "mesh JSON includes node count");
    check(json.find("\"connectivity\"") != std::string::npos,
          "mesh JSON includes element connectivity");
    check(json.find("\"element_material\"") != std::string::npos,
          "mesh JSON maps elements to materials");
    std::remove("cli_mesh.json");
}

void test_refusals() {
    std::printf("-- refusals with honest exit codes --\n");
    check(run_cli("validate no-such-file.k2d") == 3, "missing file -> exit 3");
    check(run_cli("solve no-such-file.k2d") == 3, "solve on a missing file -> exit 3");

    std::ofstream("cli_garbage.k2d") << "this is not a project";
    check(run_cli("validate cli_garbage.k2d") == 3, "garbage file -> exit 3");
    std::remove("cli_garbage.k2d");

    // An invalid but well-formed project: break a corpus case on one field.
    api::Project pr;
    std::string err;
    check(api::load_project(corpus("kv-fnd-008-strip-load.k2d"), pr, &err), "fixture loads");
    pr.materials[0].E = -1.0;
    check(api::save_project(pr, "cli_bad.k2d", &err), "broken fixture written");
    check(run_cli("validate cli_bad.k2d", "cli_bad_out.txt") == 4,
          "invalid project -> exit 4 (refused)");
    const std::string report = slurp("cli_bad_out.txt");
    check(report.find("materials[0].E") != std::string::npos,
          "the refusal reaches stdout at its exact field path");
    check(run_cli("solve cli_bad.k2d") == 4, "solve refuses the same project -> exit 4");
    std::remove("cli_bad.k2d");
    std::remove("cli_bad_out.txt");
}

void test_solve_and_identity() {
    std::printf("-- solve from a shell + cross-process identical result --\n");
    const std::string file = corpus("kv-fnd-008-strip-load.k2d");
    check(run_cli("solve \"" + file + "\" --out cli_strip.res", "cli_solve_out.txt") == 0,
          "katai solve runs the corpus case -> exit 0");
    const std::string out = slurp("cli_solve_out.txt");
    check(out.find("phase 1/1: ok") != std::string::npos, "the phase summary reaches the user");
    check(out.find("results written to") != std::string::npos, "the .res write is confirmed");
    std::remove("cli_solve_out.txt");

    check(run_cli("results \"" + file + "\" cli_strip.res", "cli_results.json") == 0,
          "katai results reads the .res through the canonical project hash");
    const std::string json = slurp("cli_results.json");
    check(json.find("\"phases\"") != std::string::npos,
          "result JSON includes calculation phases");
    check(json.find("\"displacement\"") != std::string::npos,
          "result JSON includes displacement arrays");
    check(json.find("\"stress\"") != std::string::npos,
          "result JSON includes stress arrays");
    check(json.find("\"struct_forces\"") != std::string::npos,
          "result JSON includes structural force diagrams");

    api::Project stale;
    std::string err;
    check(api::load_project(file, stale, &err), "stale-result fixture loads");
    stale.name += " changed";
    check(api::save_project(stale, "cli_stale.k2d", &err), "stale-result fixture writes");
    check(run_cli("results cli_stale.k2d cli_strip.res", "cli_stale_out.txt") == 4,
          "a model hash mismatch is refused with exit 4");
    check(slurp("cli_stale_out.txt").find("stale") != std::string::npos,
          "stale results explain that the model changed");

    std::ofstream("cli_corrupt.res", std::ios::binary) << "not a result file";
    check(run_cli("results \"" + file + "\" cli_corrupt.res") == 3,
          "a malformed results file returns exit 3");
    std::remove("cli_results.json");
    std::remove("cli_stale.k2d");
    std::remove("cli_stale_out.txt");
    std::remove("cli_corrupt.res");

    // The same file, in process, through the same facade.
    api::Project pr;
    check(api::load_project(file, pr, &err), "identity fixture loads");
    api::Job job(pr);
    check(job.run(), "in-process job ran");

    std::vector<api::SolveResult> from_cli;
    check(api::load_results("cli_strip.res", api::fnv1a64(api::project_to_json(pr)), from_cli,
                            &err),
          "the CLI's .res loads back against the canonical model hash");
    check(from_cli.size() == job.results().size(), "same phase count");
    if (from_cli.size() == job.results().size() && !from_cli.empty()) {
        const double dd =
            (from_cli.back().disp - job.results().back().disp).lpNorm<Eigen::Infinity>();
        std::printf("   max|disp(CLI process) - disp(in-process job)| = %.3e\n", dd);
        check(dd == 0.0, "cross-process displacements BIT-identical");
        check(from_cli.back().max_disp == job.results().back().max_disp,
              "cross-process max_disp bit-identical");
    }
    std::remove("cli_strip.res");

    // The Stage C gate clause, closed from a shell: EVERY corpus case solves through
    // the CLI alone (the strip case ran above with --out; the rest run here).
    const char* rest[] = {
        "kv-con-002-terzaghi-column.k2d",  "kv-fnd-009-flamant-line-load.k2d",
        "kv-num-003-k0-geostatic-block.k2d", "kv-cst-001-undrained-column.k2d",
        "kv-slp-001-griffiths-lane-slope.k2d", "kv-exc-001-staged-excavation.k2d",
    };
    for (const char* c : rest)
        check(run_cli("solve \"" + corpus(c) + "\"") == 0,
              (std::string("katai solve runs ") + c + " -> exit 0").c_str());
}

void test_live_progress_json() {
    std::printf("-- solve can atomically publish committed increment progress --\n");
    const std::string project = corpus("kv-fnd-008-strip-load.k2d");
    check(run_cli("solve \"" + project + "\" --progress cli_progress.json --monitor 1.23,0.17") == 0,
          "solve accepts the progress and monitor options");
    const std::string json = slurp("cli_progress.json");
    for (const char* key : {"\"monitor\"", "\"node_index\"", "\"samples\"",
                            "\"load_factor\"", "\"displacement\"", "\"sigma_magnitude\"",
                            "\"force_error\"", "\"iterations\""})
        check(json.find(key) != std::string::npos,
              (std::string("progress JSON includes ") + key).c_str());
    std::remove("cli_progress.json");
}

}  // namespace

int main() {
    std::printf("The katai command line: exit codes, corpus, cross-process identity\n\n");
    test_usage_and_info();
    test_validate_corpus();
    test_mesh_json();
    test_refusals();
    test_solve_and_identity();
    test_live_progress_json();
    if (g_failures == 0) {
        std::printf("\nOK: the CLI runs what the file says and cannot change the answer\n");
        return 0;
    }
    std::fprintf(stderr, "\n%d check(s) failed\n", g_failures);
    return 1;
}
