# katai_mesh — the mesher: structured fallback, constrained Delaunay and Ruppert
# quality refinement with a sizing field (src/delaunay.cpp).
add_library(katai_mesh STATIC
  src/mesh.cpp
  src/geom_predicates.cpp
  src/delaunay.cpp)
target_include_directories(katai_mesh PUBLIC include)
target_link_libraries(katai_mesh PUBLIC katai::geometry)
add_library(katai::mesh ALIAS katai_mesh)
katai_use_pch(katai_mesh)
