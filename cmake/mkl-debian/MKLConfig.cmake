# MKLConfig.cmake shim for distributions that package Intel MKL without the
# oneAPI CMake config (Debian/Ubuntu `libmkl-dev` 2020.x ships pkg-config files
# only). It provides exactly the contract the root CMakeLists.txt relies on:
#
#   MKL_FOUND   true when the headers and the lp64 / sequential / core libraries exist
#   MKL_ROOT    the install prefix (used only to derive a runtime dir for tests)
#   MKL::MKL    an INTERFACE imported target carrying include dir + link libraries
#
# It is NOT picked up by default. Opt in explicitly:
#
#   cmake -S . -B build/ubuntu-24.04-mkl -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
#         -DKATAI_WITH_MKL=ON -DMKL_DIR=$PWD/cmake/mkl-debian
#
# Added for the plaxis-parity plan, Phase 11: the portable Eigen SparseLU backend
# made undrained Hardening Soil / Soft Soil phases exceed the 5-minute cap, and
# PARDISO is the solver the reference program uses. Only the lp64 integer
# interface and the sequential threading layer are supported here, matching the
# defaults the root CMakeLists sets (MKL_INTERFACE=lp64, MKL_THREADING=sequential).

set(MKL_ROOT "/usr")
set(_mkl_libdir "/usr/lib/x86_64-linux-gnu")
set(_mkl_incdir "/usr/include/mkl")

if(DEFINED MKL_INTERFACE AND NOT MKL_INTERFACE STREQUAL "lp64")
  message(WARNING "mkl-debian shim supports MKL_INTERFACE=lp64 only (got ${MKL_INTERFACE})")
  set(MKL_FOUND FALSE)
  return()
endif()
if(DEFINED MKL_THREADING AND NOT MKL_THREADING STREQUAL "sequential")
  message(WARNING "mkl-debian shim supports MKL_THREADING=sequential only (got ${MKL_THREADING})")
  set(MKL_FOUND FALSE)
  return()
endif()

find_path(_mkl_header mkl.h PATHS "${_mkl_incdir}" NO_DEFAULT_PATH)
find_library(_mkl_lp64 mkl_intel_lp64 PATHS "${_mkl_libdir}" NO_DEFAULT_PATH)
find_library(_mkl_seq  mkl_sequential PATHS "${_mkl_libdir}" NO_DEFAULT_PATH)
find_library(_mkl_core mkl_core       PATHS "${_mkl_libdir}" NO_DEFAULT_PATH)

if(_mkl_header AND _mkl_lp64 AND _mkl_seq AND _mkl_core)
  set(MKL_FOUND TRUE)
  if(NOT TARGET MKL::MKL)
    add_library(MKL::MKL INTERFACE IMPORTED)
    set_target_properties(MKL::MKL PROPERTIES
      INTERFACE_INCLUDE_DIRECTORIES "${_mkl_header}"
      # The three MKL layers must link as one group: core depends on the
      # interface/threading layers and vice versa (static-style cross refs that
      # ld resolves left-to-right). pthread/m/dl as the pkg-config file lists.
      INTERFACE_LINK_LIBRARIES
        "-Wl,--no-as-needed;${_mkl_lp64};${_mkl_seq};${_mkl_core};-Wl,--as-needed;pthread;m;dl")
  endif()
else()
  set(MKL_FOUND FALSE)
endif()
