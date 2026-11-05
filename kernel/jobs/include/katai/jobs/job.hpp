#pragma once
// The job object (Stage D, layer 2): one headless run of a project. The mesh comes from
// the project's own settings, the run kind from its initial_procedure, and every phase
// goes through the driver -- with progress reporting, cooperative cancellation, per-phase
// timings and NO assumption about a UI. A Job holds no globals and no static solver
// state: two jobs may run concurrently in one process (pinned by test_jobs, which also
// pins that the Job path reproduces the driver path bit-identically).
//
// A Job runs on the CALLING thread; asynchrony is the caller's choice (the GUI runs one
// on its worker thread, a batch driver may spawn several). request_cancel() may be
// called from any thread and takes effect at the next phase boundary.
//
// run() executes the INPUT CONTRACT first: a project whose validation report carries
// errors is refused -- message() names the first error at its field path, report()
// holds the whole list, and nothing is meshed or solved. A front end on this path
// cannot bypass the validator (the section 7.3 boundary made mechanical). Warnings
// never block; they stay in report() for the front end to show.
//
// Scope, honestly:
//   * Cancellation is PHASE-granular today: the poll sits at the phase boundaries of
//     solve_phases. Iteration-granular cancellation needs a hook through the nonlinear
//     solver's step loop and is the remaining Stage D work (tracked in the roadmap).
//   * A flow-coupled mechanical solve (consuming a separately computed groundwater head
//     field) is front-end state today and not yet expressible in the .k2d, so it is not
//     a Job run kind yet -- that contract gap travels with the flow corpus work.
//
// New API is born in the convention namespace (katai::jobs); the driver types it wraps
// keep their katai::app spelling until the deferred rename (see ARCHITECTURE.md).

#include <atomic>
#include <chrono>
#include <functional>
#include <cmath>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include <katai/io/validate.hpp>
#include <katai/jobs/driver.hpp>
#include <katai/jobs/mesh_builder.hpp>
#include <katai/model/project.hpp>
#include <katai/analysis/post/stress_recovery.hpp>

namespace katai::jobs {

enum class JobState { Pending, Validating, Meshing, Solving, Done, Failed, Cancelled };

struct PhaseTiming {
    std::string name;
    double seconds = 0.0;
};

struct IncrementSample {
    int phase_index = 0;
    std::string phase_name;
    int increment = 0;
    double load_factor = 0.0;
    size_t node_index = 0;
    double x = 0.0;
    double y = 0.0;
    double displacement = 0.0;
    double sigma_magnitude = 0.0;
    double force_error = 0.0;
    int iterations = 0;
};

// (0-based phase index, total phases, display name), called from the running thread
// BEFORE each phase solve. Purely informational; must be thread-safe on the receiving
// side if it crosses threads. No UI type appears in this contract.
using PhaseProgress = app::PhaseProgress;

class Job {
public:
    explicit Job(model::Project project) : project_(std::move(project)) {}

    void set_on_phase(PhaseProgress cb) { on_phase_ = std::move(cb); }
    void set_monitor_point(double x, double y) {
        monitor_x_ = x;
        monitor_y_ = y;
        monitor_requested_ = true;
    }
    void set_on_increment(std::function<void(const IncrementSample&)> cb) {
        on_increment_ = std::move(cb);
    }

    // Cooperative: takes effect at the next phase boundary. Callable from any thread,
    // including from inside the progress callback (the announced phase then never runs).
    void request_cancel() { cancel_.store(true, std::memory_order_relaxed); }
    bool cancel_requested() const { return cancel_.load(std::memory_order_relaxed); }

    JobState state() const { return state_.load(std::memory_order_acquire); }

    // Run every phase on the calling thread. True only when the whole run converged;
    // otherwise state() and message() say honestly what stopped it and results() holds
    // the completed prefix.
    bool run() {
        using clock = std::chrono::steady_clock;
        if (cancel_requested()) {
            finish(JobState::Cancelled, "cancelled before the run started");
            return false;
        }

        state_.store(JobState::Validating, std::memory_order_release);
        report_ = io::validate_project(project_);
        if (!report_.ok()) {
            const io::Issue* first = nullptr;
            for (const io::Issue& i : report_.issues)
                if (i.severity == io::Severity::Error) { first = &i; break; }
            finish(JobState::Failed,
                   "the project fails its input contract: " + std::to_string(report_.errors) +
                       " error(s); the first at " +
                       (first ? first->path + ": " + first->message : std::string("?")));
            return false;
        }

        state_.store(JobState::Meshing, std::memory_order_release);
        if (project_.explicit_mesh.has_value() && project_.explicit_mesh->element_count > 0) {
            mesh_.mesh = *project_.explicit_mesh;
            mesh_.ok = true;
            mesh_.quality_met = true;
            mesh_.message = "Mesh: " + std::to_string(mesh_.mesh.node_count) + " nodes, " +
                            std::to_string(mesh_.mesh.element_count) + " elements.";
        } else {
            mesh_ = app::mesh_from_project(project_);
        }
        if (!mesh_.ok) {
            finish(JobState::Failed, mesh_.message.empty() ? "meshing failed" : mesh_.message);
            return false;
        }
        if (mesh_.mesh.node_count > 0) {
            const double x = monitor_requested_ ? monitor_x_ :
                0.5 * (project_.x_min + project_.x_max);
            const double y = monitor_requested_ ? monitor_y_ :
                0.5 * (project_.y_min + project_.y_max);
            monitor_node_ = 0;
            double best = std::numeric_limits<double>::infinity();
            for (int i = 0; i < mesh_.mesh.node_count; ++i) {
                const double dx = mesh_.mesh.x[i] - x;
                const double dy = mesh_.mesh.y[i] - y;
                const double d2 = dx * dx + dy * dy;
                if (d2 < best) { best = d2; monitor_node_ = static_cast<size_t>(i); }
            }
            monitor_resolved_ = true;
        }
        if (cancel_requested()) {
            finish(JobState::Cancelled, "cancelled after meshing");
            return false;
        }

        state_.store(JobState::Solving, std::memory_order_release);
        // Timings piggyback on the driver's progress callback: it fires at each phase
        // boundary, so it closes the previous phase's clock and opens the next one.
        clock::time_point t_open{};
        const auto progress = [this, &t_open](int cur, int total, const std::string& name) {
            const auto now = clock::now();
            if (!timings_.empty())
                timings_.back().seconds = std::chrono::duration<double>(now - t_open).count();
            timings_.push_back({name, 0.0});
            t_open = now;
            if (on_phase_) on_phase_(cur, total, name);
        };
        const auto increment = [this](int phase, const std::string& name, int number,
                                      double load, const Eigen::VectorXd& displacement,
                                      const std::vector<core::GaussState>& states,
                                      const std::vector<char>& active, double error,
                                      int iterations) {
            if (!on_increment_ || !monitor_resolved_ ||
                2 * monitor_node_ + 1 >= static_cast<size_t>(displacement.size())) return;
            const auto nodal = core::recover_nodal_stresses_from_gauss(mesh_.mesh, states, active);
            const auto& stress = nodal.stress[monitor_node_];
            IncrementSample sample;
            sample.phase_index = phase;
            sample.phase_name = name;
            sample.increment = number;
            sample.load_factor = load;
            sample.node_index = monitor_node_;
            sample.x = mesh_.mesh.x[monitor_node_];
            sample.y = mesh_.mesh.y[monitor_node_];
            sample.displacement = std::hypot(displacement[2 * monitor_node_],
                                             displacement[2 * monitor_node_ + 1]);
            sample.sigma_magnitude = std::sqrt(stress[0] * stress[0] + stress[1] * stress[1] +
                                               2.0 * stress[2] * stress[2]);
            sample.force_error = error;
            sample.iterations = iterations;
            on_increment_(sample);
        };
        results_ = app::solve_phases(project_, mesh_.mesh,
                                     app::initial_phase_from(project_.initial_procedure),
                                     progress, [this] { return cancel_requested(); }, {}, increment);
        if (!timings_.empty())
            timings_.back().seconds =
                std::chrono::duration<double>(clock::now() - t_open).count();
        // A cancelled run may have announced (and timed) a phase that never solved.
        if (timings_.size() > results_.size()) timings_.resize(results_.size());

        const size_t total = 1 + project_.phases.size();
        if (!results_.empty() && !results_.back().ok) {
            finish(JobState::Failed, results_.back().message);
            return false;
        }
        if (results_.size() < total) {   // stopped early with every completed phase ok
            finish(JobState::Cancelled,
                   "cancelled after " + std::to_string(results_.size()) + " of " +
                       std::to_string(total) + " phase(s)");
            return false;
        }
        finish(JobState::Done, "");
        return true;
    }

    const model::Project& project() const { return project_; }
    const io::ValidationReport& report() const { return report_; }
    const app::MeshResult& mesh() const { return mesh_; }
    const std::vector<app::SolveResult>& results() const { return results_; }
    const std::vector<PhaseTiming>& timings() const { return timings_; }
    const std::string& message() const { return message_; }
    bool monitor_resolved() const { return monitor_resolved_; }
    size_t monitor_node() const { return monitor_node_; }

private:
    void finish(JobState s, std::string msg) {
        message_ = std::move(msg);
        state_.store(s, std::memory_order_release);
    }

    model::Project project_;
    PhaseProgress on_phase_;
    std::function<void(const IncrementSample&)> on_increment_;
    double monitor_x_ = 0.0, monitor_y_ = 0.0;
    size_t monitor_node_ = 0;
    bool monitor_requested_ = false, monitor_resolved_ = false;
    std::atomic<bool> cancel_{false};
    std::atomic<JobState> state_{JobState::Pending};
    io::ValidationReport report_;
    app::MeshResult mesh_;
    std::vector<app::SolveResult> results_;
    std::vector<PhaseTiming> timings_;
    std::string message_;
};

}  // namespace katai::jobs
