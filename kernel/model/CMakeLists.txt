# katai_model — GUI project data model (materials, soil layers, borehole). Header-only (INTERFACE).
add_library(katai_model INTERFACE)
target_include_directories(katai_model INTERFACE include)
target_link_libraries(katai_model INTERFACE katai::geometry)   # region_edit.hpp
# model/project.hpp includes <katai/mesh/mesh.hpp> and carries a katai::mesh::Mesh by
# value, so the mesh module's include directory is part of this module's own interface.
# Without it a consumer of katai::model that does not also name katai::mesh fails to
# compile with "katai/mesh/mesh.hpp: No such file or directory" -- the include was
# satisfied by accident in every target that happened to link the mesh as well.
# Both modules sit on layer 1 and mesh does not include model, so this edge is
# acyclic and points sideways, not upward: the layer contract is untouched.
target_link_libraries(katai_model INTERFACE katai::mesh)
add_library(katai::model ALIAS katai_model)
