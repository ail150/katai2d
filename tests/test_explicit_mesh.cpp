// KV-GEO-005: the mesh a file carries survives the file.
//
// A .k2d may carry its own mesh under `explicit_mesh`. When it does, the solver uses THAT mesh
// instead of generating one, so the file describes the discretization the answer was computed
// on -- which is the whole point of the feature: a result that cannot be reproduced is not a
// result, and a mesh the user cannot see is a mesh the user cannot check.
//
// Until this case existed the feature had no test at all. The writer emitted the block and the
// reader read it back, and nothing said whether the two agreed, whether the reader accepted the
// same meshes the writer produced, or -- the part that matters most -- whether the solver actually
// USES the carried mesh or quietly discards it and meshes the model itself. A feature that is
// documented and silently inert is worse than a feature that is absent: the documentation
// promises the file describes its own discretization, and an inert implementation makes that a
// lie.
//
// The oracle is an independent path: the mesh the SOLVER ends up with is compared against the
// mesh the FILE carried, node for node, rather than the writer's own output being compared with
// the reader's own input. Both of those could agree while the solver used a third mesh.
//
// verify: KV-GEO-005
//   oracle:   independent_path
//   source:   the format contract in docs/k2d-format.md ("Explicit mesh object") and the reader's
//             own acceptance rule in kernel/io/include/katai/io/project_io.hpp ("if (m.element_count > 0 &&
//             m.x.size() == (size_t)m.node_count) p.explicit_mesh = std::move(m)"). The contract is
//             that a file which carries a mesh keeps it, and that the solver then runs on it.
//   locator:  the independent path is the solver: a Job built on a project whose file carries a mesh
//             is asked for its mesh (Job::mesh()) and that mesh is compared, node for node and
//             element for element, against the mesh the file carried. The comparison is made against
//             the SOLVER's mesh, not against the writer's output, so a writer and a reader that
//             agreed with each other while the solver discarded both would still fail here.
//   quantity: the node coordinates, the element connectivity, the per-element material ids, the
//             boundary node set and the element/node counts of the mesh the solver used [count and m]
//   expected: the solver's mesh is the carried mesh, exactly -- the same node count, the same
//             coordinates to the last bit, the same connectivity, the same material ids, the same
//             boundary set. AND the mesh the solver would otherwise have generated is a different
//             one: the check that the explicit mesh was actually taken, not merely that it was
//             present.
//   band:     none. Every field is compared for exact equality (the coordinates are doubles written
//             with "%.17g", which round-trips IEEE exactly). This is a round-trip, not a
//             discretisation, and a band would hide the very failure it is meant to catch.
#include <katai/io/project_io.hpp>
#include <katai/jobs/job.hpp>
#include <katai/jobs/mesh_builder.hpp>
#include <katai/model/project.hpp>
#include <katai/mesh/mesh.hpp>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace m = katai::model;

namespace {
int g_failures = 0;
void check(bool ok, const std::string& what) {
    if (ok) std::printf("ok:   %s\n", what.c_str());
    else { std::printf("FAIL: %s\n", what.c_str()); ++g_failures; }
}

// A carried mesh, with values chosen so that a field that was dropped or transposed could not
// pass by accident: non-zero, non-uniform, and of a size that is not a multiple of anything.
katai::mesh::Mesh make_carried_mesh() {
    katai::mesh::Mesh mesh;
    mesh.nodes_per_element = 6;
    mesh.node_count = 7;
    mesh.element_count = 2;
    mesh.x = {0.0, 1.25, 2.5, 3.75, 5.0, 6.25, 7.5};
    mesh.y = {0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0};
    // Two tri6 elements: 3 corner nodes + 3 mid-edge nodes each. The connectivity is deliberately
    // NOT the identity, so a reader that read the wrong array, or read the array in the wrong
    // order, cannot produce the same numbers.
    mesh.connectivity = {0, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 6};
    mesh.element_material = {0, 1};
    mesh.boundary_nodes = {0, 6};
    return mesh;
}

// A project that meshes and solves: one soil polygon over a rectangle, one material.
m::Project make_project() {
    m::Project pr;
    pr.name = "Explicit mesh";
    pr.x_min = 0.0; pr.x_max = 20.0; pr.y_min = 0.0; pr.y_max = 10.0;
    pr.materials.resize(1);
    m::Material mat;
    mat.name = "Soil"; mat.model = m::SoilModel::MohrCoulomb;
    mat.gamma_sat = 19.0; mat.gamma_unsat = 19.0; mat.E = 5.0e4; mat.nu = 0.3;
    mat.c = 2.0; mat.phi = 30.0; mat.kx = 1.0; mat.ky = 1.0;
    pr.materials[0] = mat;
    m::SoilPolygon P;
    P.name = "Soil"; P.material = 0;
    P.x = {0.0, 20.0, 20.0, 0.0};
    P.y = {0.0, 0.0, 10.0, 10.0};
    P.edge_bc.assign(4, 0);
    pr.polygons = {P};
    pr.mesh.elem_size = 2.0;
    return pr;
}

// Field-by-field equality of two meshes. Exact, not banded: the coordinates went through JSON
// as "%.17g", which is IEEE round-trip exact, so a difference here is a real difference.
bool same_mesh(const katai::mesh::Mesh& a, const katai::mesh::Mesh& b) {
    if (a.node_count != b.node_count) return false;
    if (a.element_count != b.element_count) return false;
    if (a.nodes_per_element != b.nodes_per_element) return false;
    if (a.x.size() != b.x.size() || a.y.size() != b.y.size()) return false;
    for (size_t i = 0; i < a.x.size(); ++i)
        if (a.x[i] != b.x[i] || a.y[i] != b.y[i]) return false;
    if (a.connectivity.size() != b.connectivity.size()) return false;
    for (size_t i = 0; i < a.connectivity.size(); ++i)
        if (a.connectivity[i] != b.connectivity[i]) return false;
    if (a.element_material.size() != b.element_material.size()) return false;
    for (size_t i = 0; i < a.element_material.size(); ++i)
        if (a.element_material[i] != b.element_material[i]) return false;
    if (a.boundary_nodes.size() != b.boundary_nodes.size()) return false;
    for (size_t i = 0; i < a.boundary_nodes.size(); ++i)
        if (a.boundary_nodes[i] != b.boundary_nodes[i]) return false;
    return true;
}

// ---- case 1: the writer emits the block, and the reader reads back what it wrote ----
void case_the_block_survives_the_file() {
    std::printf("\n== the block survives the file ==\n");
    m::Project pr = make_project();
    pr.explicit_mesh = make_carried_mesh();

    const std::string text = m::project_to_json(pr);
    check(text.find("\"explicit_mesh\"") != std::string::npos,
          "the writer emits the explicit_mesh block");
    for (const char* key : {"node_count", "element_count", "nodes_per_element",
                             "x", "y", "connectivity", "element_material", "boundary_nodes"}) {
        check(text.find(std::string("\"") + key + "\"") != std::string::npos,
              std::string("the block carries ") + key);
    }

    m::Project back;
    std::string err;
    check(m::project_from_json(text, back, &err), "the file parses back");
    if (!err.empty()) std::printf("  (%s)\n", err.c_str());
    check(back.explicit_mesh.has_value(), "the reader found a carried mesh");
    if (!back.explicit_mesh) return;
    check(same_mesh(*back.explicit_mesh, *pr.explicit_mesh),
          "and it is the very mesh that went in, field for field");

    // A second generation must be byte-identical: the writer is deterministic, so a file that
    // round-trips is a file that can be compared against another copy of itself.
    check(m::project_to_json(back) == text, "save(load(save(p))) is byte-identical");
}

// ---- case 2: the reader accepts and refuses on the documented rule ----
void case_the_readers_rule_is_the_documented_one() {
    std::printf("\n== the reader accepts and refuses on the documented rule ==\n");
    // The rule the reader states: a mesh is taken when it has elements AND its coordinate array
    // is as long as its node count. A mesh that fails it is not carried -- and is NOT reported as
    // an error either, because an inconsistent mesh block is the writer's mistake, not the user's
    // input: the file still describes a model, just not with a usable mesh.
    const std::string good = R"({"katai2d":1,"version":29,"explicit_mesh":{)"
                             R"("node_count":2,"element_count":1,"nodes_per_element":3,)"
                             R"("x":[0.0,1.0],"y":[0.0,1.0],"connectivity":[0,1,2],)"
                             R"("element_material":[0],"boundary_nodes":[0,1]}})";
    m::Project p;
    std::string err;
    check(m::project_from_json(good, p, &err), "a consistent mesh block loads");
    check(p.explicit_mesh.has_value() && p.explicit_mesh->node_count == 2 &&
              p.explicit_mesh->element_count == 1,
          "and the mesh is carried with its counts");

    // x has 3 entries while node_count says 2: inconsistent, so not carried.
    const std::string mismatched = R"({"katai2d":1,"version":29,"explicit_mesh":{)"
                                   R"("node_count":2,"element_count":1,"nodes_per_element":3,)"
                                   R"("x":[0.0,1.0,2.0],"y":[0.0,1.0],"connectivity":[0,1,2],)"
                                   R"("element_material":[0],"boundary_nodes":[0,1]}})";
    m::Project q;
    err.clear();
    check(m::project_from_json(mismatched, q, &err), "an inconsistent mesh block still loads the project");
    check(!q.explicit_mesh.has_value(),
          "but the mesh is not carried: its coordinates disagree with its node count");

    // No elements at all: nothing to solve on, so nothing is carried.
    const std::string empty = R"({"katai2d":1,"version":29,"explicit_mesh":{)"
                              R"("node_count":2,"element_count":0,"nodes_per_element":3,)"
                              R"("x":[0.0,1.0],"y":[0.0,1.0],"connectivity":[],)"
                              R"("element_material":[],"boundary_nodes":[]}})";
    m::Project r;
    err.clear();
    check(m::project_from_json(empty, r, &err), "a mesh block with no elements still loads the project");
    check(!r.explicit_mesh.has_value(), "and carries no mesh");
}

// ---- case 3: the SOLVER uses the carried mesh ----
void case_the_solver_uses_the_carried_mesh() {
    std::printf("\n== the solver runs on the mesh the file carried ==\n");
    m::Project pr = make_project();
    const katai::mesh::Mesh carried = make_carried_mesh();
    pr.explicit_mesh = carried;

    katai::jobs::Job job(pr);
    job.run();
    check(job.mesh().ok, "the job meshed");
    if (!job.mesh().ok) { std::printf("      (%s)\n", job.mesh().message.c_str()); return; }
    check(same_mesh(job.mesh().mesh, carried),
          "and the mesh it used is the carried one, not one it generated");

    // The control: the SAME project without the carried mesh must produce a DIFFERENT mesh. If
    // the two were the same, the check above would pass for a solver that ignores the carried
    // mesh and generates the same one every time -- which is the failure this case exists for.
    m::Project plain = make_project();
    katai::jobs::Job control(plain);
    control.run();
    check(control.mesh().ok, "the control job meshed too");
    if (control.mesh().ok) {
        check(!same_mesh(control.mesh().mesh, carried),
              "the generated mesh is a different one, so the carried mesh was really the one used");
        std::printf("  carried: %d nodes, %d elements; generated: %d nodes, %d elements\n",
                    carried.node_count, carried.element_count,
                    control.mesh().mesh.node_count, control.mesh().mesh.element_count);
    }
}

}  // namespace

int main() {
    std::printf("== KV-GEO-005: the mesh a file carries survives the file ==\n");
    case_the_block_survives_the_file();
    case_the_readers_rule_is_the_documented_one();
    case_the_solver_uses_the_carried_mesh();
    if (g_failures == 0) {
        std::printf("\nOK: the carried mesh is written, read back, and the one the solver used\n");
        return 0;
    }
    std::fprintf(stderr, "\n%d check(s) failed\n", g_failures);
    return 1;
}
