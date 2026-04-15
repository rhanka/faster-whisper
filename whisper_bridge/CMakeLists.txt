cmake_minimum_required(VERSION 3.14)
project(whisper_bridge)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Options for CTranslate2
set(BUILD_CLI OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WITH_OPENBLAS OFF CACHE BOOL "" FORCE)
set(WITH_MKL OFF CACHE BOOL "" FORCE)
set(WITH_RUY ON CACHE BOOL "" FORCE)
set(WITH_CUDA OFF CACHE BOOL "" FORCE)
set(WITH_CUDNN OFF CACHE BOOL "" FORCE)
set(WITH_OPENMP OFF CACHE BOOL "" FORCE)
set(OPENMP_RUNTIME "COMP" CACHE STRING "" FORCE)




set(CTRANSLATE2_VENDOR_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/vendor/ctranslate2")
set(CTRANSLATE2_INCLUDE_DIR "${CTRANSLATE2_VENDOR_ROOT}/include")
set(CTRANSLATE2_LIBRARY_DIR "${CMAKE_CURRENT_SOURCE_DIR}/lib")

find_library(
  CTRANSLATE2_LIBRARY
  NAMES libctranslate2-5a650b64.so.4.7.1 ctranslate2 libctranslate2.so.4 libctranslate2.so
  PATHS "${CTRANSLATE2_LIBRARY_DIR}"
  NO_DEFAULT_PATH
)

find_library(
  LIBGOMP_LIBRARY
  NAMES libgomp-e985bcbb.so.1.0.0 libgomp.so.1 libgomp.so
  PATHS "${CTRANSLATE2_LIBRARY_DIR}"
  NO_DEFAULT_PATH
)

if(NOT EXISTS "${CTRANSLATE2_INCLUDE_DIR}/ctranslate2/models/whisper.h")
  message(FATAL_ERROR "Missing vendored CTranslate2 headers in ${CTRANSLATE2_INCLUDE_DIR}")
endif()

if(NOT CTRANSLATE2_LIBRARY)
  message(FATAL_ERROR "Missing vendored CTranslate2 shared library in ${CTRANSLATE2_LIBRARY_DIR}")
endif()

if(NOT LIBGOMP_LIBRARY)
  message(FATAL_ERROR "Missing vendored libgomp shared library in ${CTRANSLATE2_LIBRARY_DIR}")
endif()

add_library(whisper_bridge SHARED bridge.cpp)
target_include_directories(whisper_bridge PRIVATE "${CTRANSLATE2_INCLUDE_DIR}")
target_link_libraries(whisper_bridge PRIVATE "${CTRANSLATE2_LIBRARY}" "${LIBGOMP_LIBRARY}")
target_link_options(whisper_bridge PRIVATE "-Wl,--disable-new-dtags")
set_target_properties(whisper_bridge PROPERTIES
    BUILD_RPATH "$ORIGIN/../lib"
    INSTALL_RPATH "$ORIGIN/../lib"
)

if(CMAKE_JS_VERSION)
    # Expose for Node-API / cmake-js if needed, but since we use FFI we just need the .so
    set_target_properties(whisper_bridge PROPERTIES PREFIX "")
endif()
