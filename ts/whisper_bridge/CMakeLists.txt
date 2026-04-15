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




include(FetchContent)

set(CTRANSLATE2_LOCAL_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/../ctranslate2_src")
set(CTRANSLATE2_LOCAL_READY FALSE)

if(
  EXISTS "${CTRANSLATE2_LOCAL_SOURCE}/CMakeLists.txt"
  AND EXISTS "${CTRANSLATE2_LOCAL_SOURCE}/third_party/spdlog/CMakeLists.txt"
  AND EXISTS "${CTRANSLATE2_LOCAL_SOURCE}/third_party/cpu_features/CMakeLists.txt"
  AND EXISTS "${CTRANSLATE2_LOCAL_SOURCE}/third_party/ruy/CMakeLists.txt"
)
  set(CTRANSLATE2_LOCAL_READY TRUE)
endif()

if(CTRANSLATE2_LOCAL_READY)
  message(STATUS "Using vendored CTranslate2 sources from ${CTRANSLATE2_LOCAL_SOURCE}")
  add_subdirectory("${CTRANSLATE2_LOCAL_SOURCE}" "${CMAKE_CURRENT_BINARY_DIR}/ctranslate2")
  set(ctranslate2_SOURCE_DIR "${CTRANSLATE2_LOCAL_SOURCE}")
else()
  FetchContent_Declare(
    ctranslate2
    GIT_REPOSITORY https://github.com/OpenNMT/CTranslate2.git
    GIT_TAG        v4.4.0
  )
  FetchContent_MakeAvailable(ctranslate2)
endif()

add_library(whisper_bridge SHARED bridge.cpp)
target_include_directories(whisper_bridge PRIVATE ${ctranslate2_SOURCE_DIR}/include)
target_link_libraries(whisper_bridge PRIVATE ctranslate2)

if(CMAKE_JS_VERSION)
    # Expose for Node-API / cmake-js if needed, but since we use FFI we just need the .so
    set_target_properties(whisper_bridge PROPERTIES PREFIX "")
endif()
