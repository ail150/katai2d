// study_hs_replay -- replays the slowest Hardening Soil integrations a run recorded.
//
// A run with KATAI_HS_STATS=<file> writes, after its summary, one "REPLAY" line per slowest call:
// the call's exact input (doubles in %a) and its parameter set as bytes. This study integrates each
// one again, alone, and reports its cost and its answer -- at the tolerance it was asked for and,
// for reference, at a far tighter one -- so a change to the integrator can be measured on exactly
// the stress points that made a run slow, without the run.
//
//   study_hs_replay <stats-file> [ref_stol=1e-9]
#include <katai/materials/hardening_soil_plastic.hpp>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using katai::core::HardeningSoilParams;

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: study_hs_replay <stats-file> [ref_stol]\n"); return 2; }
    const double ref_tol = argc > 2 ? std::atof(argv[2]) : 1e-9;
    std::ifstream in(argv[1]);
    std::string line;
    int k = 0;
    std::printf("#  ms   nsub sat |  ms_ref nsub_ref | |s-s_ref|/max(|s_ref|,pr/20) | sig0 -> out\n");
    while (std::getline(in, line)) {
        if (line.rfind("REPLAY ", 0) != 0) continue;
        std::istringstream ss(line.substr(7));
        std::string tok[9], hex;
        for (auto& t : tok) ss >> t;
        ss >> hex;
        double v[9];
        for (int i = 0; i < 9; ++i) v[i] = std::strtod(tok[i].c_str(), nullptr);
        HardeningSoilParams p;
        if (hex.size() != 2 * sizeof(HardeningSoilParams)) {
            std::fprintf(stderr, "line %d: parameter bytes %zu, expected %zu (rebuilt since?)\n", k,
                         hex.size() / 2, sizeof(HardeningSoilParams));
            return 3;
        }
        unsigned char* b = reinterpret_cast<unsigned char*>(&p);
        for (size_t i = 0; i < sizeof(HardeningSoilParams); ++i)
            b[i] = (unsigned char)std::strtoul(hex.substr(2 * i, 2).c_str(), nullptr, 16);
        const Eigen::Vector3d s0(v[0], v[1], v[2]), de(v[5], v[6], v[7]);
        auto run = [&](double stol, double& ms) {
            const auto a = std::chrono::steady_clock::now();
            auto r = katai::core::hs_integrate(p, s0, v[3], v[4], de, stol);
            ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - a).count();
            return r;
        };
        double ms = 0, ms_ref = 0;
        const auto r = run(v[8], ms);
        const auto rr = run(ref_tol, ms_ref);
        const double err = (r.stress - rr.stress).norm() / std::max(rr.stress.norm(), p.p_ref / 20.0);
        std::printf("%2d %7.2f %6d %d | %8.2f %7d | %.3e | (%.4g %.4g %.4g) -> (%.6g %.6g %.6g)\n", k, ms,
                    r.nsub, r.saturated, ms_ref, rr.nsub, err, s0(0), s0(1), s0(2), r.stress(0),
                    r.stress(1), r.stress(2));
        ++k;
    }
    return 0;
}
