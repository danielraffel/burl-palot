cmake_minimum_required(VERSION 3.25)
project(burl_palot LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(BURL_PALOT_ENABLE_FRAMEWORK "Resolve the immutable Burl SDK and build Palot" ON)
option(PALOT_BUILD_TESTS "Build focused native Palot tests" ON)
set(BURL_SOURCE_DIR "" CACHE PATH "Explicit local Burl checkout override (development only)")
set(PALOT_OPENCODE_SIDECAR_EXECUTABLE "" CACHE FILEPATH
	"Prebuilt palot-opencode-sidecar executable (otherwise built with Bun)")
set(PALOT_OPENCODE_SIDECAR_SHA256 "" CACHE STRING "Expected SHA-256 for a prebuilt sidecar")
set(PALOT_OPENCODE_SIDECAR_PROVENANCE "" CACHE FILEPATH
	"JSON provenance statement for a prebuilt sidecar")
set(PALOT_OPENCODE_SIDECAR_ARCH "arm64" CACHE STRING "Expected prebuilt sidecar architecture")

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/burl.lock.json" BURL_LOCK)
string(JSON BURL_REPOSITORY GET "${BURL_LOCK}" repository)
string(JSON BURL_REVISION GET "${BURL_LOCK}" revision)

string(LENGTH "${BURL_REVISION}" BURL_REVISION_LENGTH)
if(NOT BURL_REVISION MATCHES "^[0-9a-f]+$" OR NOT BURL_REVISION_LENGTH EQUAL 40)
	message(FATAL_ERROR "burl.lock.json must pin a full immutable Git commit")
endif()

add_custom_target(burl-palot-consumer-boundary ALL
	COMMAND "${CMAKE_COMMAND}" -E echo
		"burl-palot consumer pin: ${BURL_REPOSITORY}@${BURL_REVISION}"
	VERBATIM)

if(BURL_PALOT_ENABLE_FRAMEWORK)
	include(FetchContent)
	FetchContent_Declare(nlohmann_json
		GIT_REPOSITORY https://github.com/nlohmann/json.git
		GIT_TAG 9cca280a4d0ccf0c08f47a99aa71d1b0e52f8d03
		GIT_SHALLOW TRUE)
	FetchContent_MakeAvailable(nlohmann_json)

	if(BURL_SOURCE_DIR)
		if(NOT IS_ABSOLUTE "${BURL_SOURCE_DIR}")
			message(FATAL_ERROR "BURL_SOURCE_DIR must be an explicit absolute path")
		endif()
		add_subdirectory("${BURL_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/_deps/burl-build")
	else()
		include(FetchContent)
		FetchContent_Declare(burl
			GIT_REPOSITORY "${BURL_REPOSITORY}"
			GIT_TAG "${BURL_REVISION}"
			GIT_SHALLOW FALSE)
		FetchContent_MakeAvailable(burl)
	endif()

	if(NOT COMMAND burl_add_app)
		message(FATAL_ERROR
			"Pinned Burl revision does not export burl_add_app")
	endif()

	burl_add_app(burl-palot
		SOURCES
			src/main.cpp
			src/imported_root_host.cpp
			src/opencode_process.cpp
			src/project_config.cpp
			src/palot_view.cpp
		APP_NAME "Palot"
		BUNDLE_ID "com.palot.burl"
		VERSION "0.1.0")
	target_link_libraries(burl-palot PRIVATE nlohmann_json::nlohmann_json)
	set_property(TARGET burl-palot APPEND PROPERTY LINK_DEPENDS
		"${CMAKE_CURRENT_SOURCE_DIR}/resources/import/main-chat.observed.design-ir.v1.json"
		"${CMAKE_CURRENT_SOURCE_DIR}/contracts/main-chat.application-bindings.v1.json"
		"${CMAKE_CURRENT_SOURCE_DIR}/contracts/main-chat.source-binding-policy.v1.json")

	set(PALOT_SIDECAR_NAME "palot-opencode-sidecar")
	set(PALOT_SIDECAR_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/sidecar")
	set(PALOT_SIDECAR_OUTPUT "${PALOT_SIDECAR_BUILD_DIR}/${PALOT_SIDECAR_NAME}")
	set(PALOT_SIDECAR_SHA_FILE "${PALOT_SIDECAR_BUILD_DIR}/${PALOT_SIDECAR_NAME}.sha256")
	set(PALOT_SIDECAR_PROVENANCE_FILE "${PALOT_SIDECAR_BUILD_DIR}/${PALOT_SIDECAR_NAME}.provenance.json")
	set(PALOT_REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
	file(SHA256 "${PALOT_REPOSITORY_ROOT}/bun.lock" PALOT_LOCK_SHA256)
	set(PALOT_EXPECTED_LOCK_SHA256 "c0a5b86bc7118af40763a189529ef2f6bf7145b5b3eafc486108447d9d233c6a")
	if(NOT PALOT_LOCK_SHA256 STREQUAL PALOT_EXPECTED_LOCK_SHA256)
		message(FATAL_ERROR "bun.lock digest does not match the sidecar manifest")
	endif()

	if(PALOT_OPENCODE_SIDECAR_EXECUTABLE)
		string(LENGTH "${PALOT_OPENCODE_SIDECAR_SHA256}" PALOT_SIDECAR_SHA256_LENGTH)
		if(NOT IS_ABSOLUTE "${PALOT_OPENCODE_SIDECAR_EXECUTABLE}" OR
			NOT EXISTS "${PALOT_OPENCODE_SIDECAR_EXECUTABLE}")
			message(FATAL_ERROR
				"PALOT_OPENCODE_SIDECAR_EXECUTABLE must name an existing absolute file")
		endif()
		if(NOT PALOT_OPENCODE_SIDECAR_SHA256 MATCHES "^[0-9a-f]+$" OR
			NOT PALOT_SIDECAR_SHA256_LENGTH EQUAL 64 OR
			NOT IS_ABSOLUTE "${PALOT_OPENCODE_SIDECAR_PROVENANCE}" OR
			NOT EXISTS "${PALOT_OPENCODE_SIDECAR_PROVENANCE}" OR
			PALOT_OPENCODE_SIDECAR_ARCH STREQUAL "")
			message(FATAL_ERROR
				"Prebuilt sidecars require exact SHA-256, architecture, and existing absolute provenance")
		endif()
		add_custom_command(OUTPUT "${PALOT_SIDECAR_OUTPUT}" "${PALOT_SIDECAR_SHA_FILE}"
			"${PALOT_SIDECAR_PROVENANCE_FILE}"
			COMMAND "${CMAKE_COMMAND}" -E make_directory "${PALOT_SIDECAR_BUILD_DIR}"
			COMMAND "${PALOT_REPOSITORY_ROOT}/scripts/verify-sidecar-artifact.sh"
				"${PALOT_OPENCODE_SIDECAR_EXECUTABLE}" "${PALOT_OPENCODE_SIDECAR_SHA256}"
				"${PALOT_OPENCODE_SIDECAR_ARCH}" "${PALOT_OPENCODE_SIDECAR_PROVENANCE}"
			COMMAND "${CMAKE_COMMAND}" -E copy
				"${PALOT_OPENCODE_SIDECAR_EXECUTABLE}" "${PALOT_SIDECAR_OUTPUT}"
			COMMAND "${PALOT_REPOSITORY_ROOT}/scripts/verify-sidecar-artifact.sh"
				"${PALOT_SIDECAR_OUTPUT}" "${PALOT_OPENCODE_SIDECAR_SHA256}"
				"${PALOT_OPENCODE_SIDECAR_ARCH}" "${PALOT_OPENCODE_SIDECAR_PROVENANCE}"
			COMMAND "${CMAKE_COMMAND}"
				"-DSIDECAR=${PALOT_SIDECAR_OUTPUT}"
				"-DOUTPUT_SHA_FILE=${PALOT_SIDECAR_SHA_FILE}"
				"-DOUTPUT_PROVENANCE=${PALOT_SIDECAR_PROVENANCE_FILE}"
				"-DSOURCE_PROVENANCE=${PALOT_OPENCODE_SIDECAR_PROVENANCE}"
				-P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/write_sidecar_metadata.cmake"
			DEPENDS "${PALOT_OPENCODE_SIDECAR_EXECUTABLE}"
				"${PALOT_OPENCODE_SIDECAR_PROVENANCE}"
			VERBATIM)
	else()
		find_program(PALOT_BUN_EXECUTABLE bun HINTS "$ENV{HOME}/.bun/bin")
		if(NOT PALOT_BUN_EXECUTABLE)
			message(FATAL_ERROR
				"Bun is required to compile the OpenCode sidecar; alternatively set "
				"PALOT_OPENCODE_SIDECAR_EXECUTABLE to a prebuilt absolute path")
		endif()
		file(READ "${PALOT_REPOSITORY_ROOT}/package.json" PALOT_PACKAGE_JSON)
		string(JSON PALOT_PACKAGE_MANAGER GET "${PALOT_PACKAGE_JSON}" packageManager)
		if(NOT PALOT_PACKAGE_MANAGER MATCHES "^bun@([0-9]+\\.[0-9]+\\.[0-9]+)$")
			message(FATAL_ERROR "packageManager must pin an exact bun@x.y.z version")
		endif()
		set(PALOT_EXPECTED_BUN_VERSION "${CMAKE_MATCH_1}")
		execute_process(COMMAND "${PALOT_BUN_EXECUTABLE}" --version
			OUTPUT_VARIABLE PALOT_ACTUAL_BUN_VERSION OUTPUT_STRIP_TRAILING_WHITESPACE
			RESULT_VARIABLE PALOT_BUN_VERSION_RESULT)
		if(NOT PALOT_BUN_VERSION_RESULT EQUAL 0 OR
			NOT PALOT_ACTUAL_BUN_VERSION STREQUAL PALOT_EXPECTED_BUN_VERSION)
			message(FATAL_ERROR
				"Bun ${PALOT_EXPECTED_BUN_VERSION} is required; found ${PALOT_ACTUAL_BUN_VERSION}")
		endif()
		file(GLOB_RECURSE PALOT_SIDECAR_SOURCES CONFIGURE_DEPENDS
			"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/src/*.ts"
			"${PALOT_REPOSITORY_ROOT}/packages/opencode/src/*.ts")
		add_custom_command(OUTPUT "${PALOT_SIDECAR_OUTPUT}" "${PALOT_SIDECAR_SHA_FILE}"
			"${PALOT_SIDECAR_PROVENANCE_FILE}"
			COMMAND "${CMAKE_COMMAND}" -E make_directory "${PALOT_SIDECAR_BUILD_DIR}"
			COMMAND "${PALOT_BUN_EXECUTABLE}" build --compile
				"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/src/main.ts"
				--outfile "${PALOT_SIDECAR_OUTPUT}"
			COMMAND "${CMAKE_COMMAND}"
				"-DSIDECAR=${PALOT_SIDECAR_OUTPUT}"
				"-DOUTPUT_SHA_FILE=${PALOT_SIDECAR_SHA_FILE}"
				"-DOUTPUT_PROVENANCE=${PALOT_SIDECAR_PROVENANCE_FILE}"
				"-DBUN_VERSION=${PALOT_EXPECTED_BUN_VERSION}"
				"-DLOCK_SHA256=${PALOT_LOCK_SHA256}"
				-P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/write_sidecar_metadata.cmake"
			WORKING_DIRECTORY "${PALOT_REPOSITORY_ROOT}"
			DEPENDS ${PALOT_SIDECAR_SOURCES}
				"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/package.json"
				"${PALOT_REPOSITORY_ROOT}/packages/opencode/package.json"
				"${PALOT_REPOSITORY_ROOT}/bun.lock"
			COMMENT "Compiling self-contained OpenCode sidecar"
			VERBATIM)
	endif()

	add_custom_target(palot-opencode-sidecar DEPENDS "${PALOT_SIDECAR_OUTPUT}"
		"${PALOT_SIDECAR_SHA_FILE}" "${PALOT_SIDECAR_PROVENANCE_FILE}")
	add_dependencies(burl-palot palot-opencode-sidecar)
	target_include_directories(burl-palot PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/include")
	target_compile_definitions(burl-palot PRIVATE
		PALOT_OPENCODE_SIDECAR_RESOURCE_PATH="bin/${PALOT_SIDECAR_NAME}"
		PALOT_RESOURCE_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/resources")

	add_custom_command(TARGET burl-palot POST_BUILD
		COMMAND "${CMAKE_COMMAND}" -E make_directory
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/import"
		COMMAND "${CMAKE_COMMAND}" -E make_directory
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/contracts"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${CMAKE_CURRENT_SOURCE_DIR}/resources/import/main-chat.observed.design-ir.v1.json"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/import/main-chat.observed.design-ir.v1.json"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${CMAKE_CURRENT_SOURCE_DIR}/contracts/main-chat.application-bindings.v1.json"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/contracts/main-chat.application-bindings.v1.json"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${CMAKE_CURRENT_SOURCE_DIR}/contracts/source-window.browser-window.v1.json"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/contracts/source-window.browser-window.v1.json"
		COMMAND "${CMAKE_COMMAND}" -E make_directory
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/bin"
		COMMAND "${CMAKE_COMMAND}" -E copy "${PALOT_SIDECAR_OUTPUT}"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/bin/${PALOT_SIDECAR_NAME}"
		COMMAND "${CMAKE_COMMAND}" -E compare_files "${PALOT_SIDECAR_OUTPUT}"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/bin/${PALOT_SIDECAR_NAME}"
		COMMAND chmod 755
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/bin/${PALOT_SIDECAR_NAME}"
		COMMAND "${CMAKE_COMMAND}" -E make_directory
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/licenses"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${PALOT_REPOSITORY_ROOT}/LICENSE"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/licenses/Palot-LICENSE"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${PALOT_REPOSITORY_ROOT}/THIRD-PARTY-NOTICES.md"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/licenses/THIRD-PARTY-NOTICES.md"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/THIRD-PARTY-NOTICES.md"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/licenses/SIDECAR-NOTICES.md"
		COMMAND "${CMAKE_COMMAND}" -E copy "${PALOT_SIDECAR_SHA_FILE}"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/${PALOT_SIDECAR_NAME}.sha256"
		COMMAND "${CMAKE_COMMAND}" -E copy "${PALOT_SIDECAR_PROVENANCE_FILE}"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/${PALOT_SIDECAR_NAME}.provenance.json"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${CMAKE_CURRENT_SOURCE_DIR}/resources/licenses/OpenCode-SDK-LICENSE"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/licenses/OpenCode-SDK-LICENSE"
		COMMAND "${CMAKE_COMMAND}" -E copy
			"${CMAKE_CURRENT_SOURCE_DIR}/resources/sidecar-manifest.json"
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/sidecar-manifest.json"
		COMMENT "Embedding OpenCode sidecar and license manifest in Palot.app"
		VERBATIM)

	if(PALOT_BUILD_TESTS)
		enable_testing()
		add_executable(palot-opencode-process-test
			test/opencode_process_test.cpp
			src/opencode_process.cpp)
		target_include_directories(palot-opencode-process-test PRIVATE src)
		target_link_libraries(palot-opencode-process-test PRIVATE
			nlohmann_json::nlohmann_json)
		add_executable(palot-project-config-test
			test/project_config_test.cpp
			src/project_config.cpp)
		target_include_directories(palot-project-config-test PRIVATE src)
		add_executable(palot-source-aware-slice-test
			test/source_aware_chat_slice_test.cpp
			src/source_aware_chat_slice.cpp)
		target_include_directories(palot-source-aware-slice-test PRIVATE src)
		target_link_libraries(palot-source-aware-slice-test PRIVATE
			nlohmann_json::nlohmann_json pulp-view pulp-state)
		add_executable(palot-authored-theme-test test/authored_theme_test.cpp)
		target_link_libraries(palot-authored-theme-test PRIVATE pulp-view)
		add_executable(palot-phase-b-native-component test/phase_b_native_component.cpp)
		target_link_libraries(palot-phase-b-native-component PRIVATE
			nlohmann_json::nlohmann_json pulp-view)
		if(BURL_SOURCE_DIR AND EXISTS
			"${BURL_SOURCE_DIR}/core/view/include/pulp/view/application_binding_manifest.hpp")
			add_executable(palot-application-binding-manifest-test
				test/application_binding_manifest_test.cpp)
			target_link_libraries(palot-application-binding-manifest-test PRIVATE pulp-view)
			add_test(NAME palot-application-binding-manifest
				COMMAND palot-application-binding-manifest-test
					"${CMAKE_CURRENT_SOURCE_DIR}/contracts/main-chat.application-bindings.v1.json")
		endif()
		add_test(NAME palot-opencode-process
			COMMAND palot-opencode-process-test
				"${CMAKE_CURRENT_SOURCE_DIR}/test/fake_sidecar.py"
				"${PALOT_SIDECAR_OUTPUT}")
		add_test(NAME palot-project-config COMMAND palot-project-config-test)
		add_test(NAME palot-source-aware-slice
			COMMAND palot-source-aware-slice-test
				"${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/source-aware-stream.json")
		add_test(NAME palot-authored-theme
			COMMAND palot-authored-theme-test
				"${CMAKE_CURRENT_SOURCE_DIR}/resources/tokens/palot-authored-theme.sidecar.json")
		find_program(PALOT_PYTHON3_EXECUTABLE python3 REQUIRED)
		add_test(NAME palot-authored-theme-generation
			COMMAND "${PALOT_PYTHON3_EXECUTABLE}"
				"${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-authored-theme-sidecar.py"
				--repo "${CMAKE_CURRENT_SOURCE_DIR}/../.."
				--check "${CMAKE_CURRENT_SOURCE_DIR}/resources/tokens/palot-authored-theme.sidecar.json")
		add_executable(palot-observed-design-ir-test
			test/observed_design_ir_test.cpp)
		target_link_libraries(palot-observed-design-ir-test PRIVATE pulp-view)
		add_test(NAME palot-observed-design-ir
			COMMAND palot-observed-design-ir-test
				"${CMAKE_CURRENT_SOURCE_DIR}/resources/import/main-chat.observed.design-ir.v1.json")
		add_executable(palot-imported-root-host-test
			test/imported_root_host_test.cpp
			src/imported_root_host.cpp)
		target_include_directories(palot-imported-root-host-test PRIVATE src)
		target_compile_definitions(palot-imported-root-host-test PRIVATE
			PALOT_RESOURCE_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/resources")
		target_link_libraries(palot-imported-root-host-test PRIVATE pulp-view)
		add_test(NAME palot-imported-root-host
			COMMAND palot-imported-root-host-test
				"${CMAKE_CURRENT_SOURCE_DIR}/resources/import/main-chat.observed.design-ir.v1.json"
				"${CMAKE_CURRENT_SOURCE_DIR}/contracts/main-chat.application-bindings.v1.json")
		add_executable(palot-native-interaction-execution-test
			test/native_interaction_execution_test.cpp src/imported_root_host.cpp)
		target_include_directories(palot-native-interaction-execution-test PRIVATE src)
		target_compile_definitions(palot-native-interaction-execution-test PRIVATE
			PALOT_RESOURCE_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/resources")
		target_link_libraries(palot-native-interaction-execution-test PRIVATE pulp-view)
		add_test(NAME palot-native-interaction-execution
			COMMAND palot-native-interaction-execution-test
				"${CMAKE_CURRENT_SOURCE_DIR}/resources/import/main-chat.observed.design-ir.v1.json"
				"${CMAKE_CURRENT_SOURCE_DIR}/contracts/main-chat.application-bindings.v1.json")
		add_test(NAME palot-accessibility-dump
			COMMAND $<TARGET_FILE:burl-palot> --accessibility-dump)
		set_tests_properties(palot-accessibility-dump PROPERTIES TIMEOUT 5)
	endif()
endif()
