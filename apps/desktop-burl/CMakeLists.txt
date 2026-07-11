cmake_minimum_required(VERSION 3.25)
project(burl_palot LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(BURL_PALOT_ENABLE_FRAMEWORK "Resolve the immutable Burl SDK and build Palot" ON)
option(PALOT_BUILD_TESTS "Build focused native Palot tests" ON)
set(BURL_SOURCE_DIR "" CACHE PATH "Explicit local Burl checkout override (development only)")
set(PALOT_OPENCODE_SIDECAR_EXECUTABLE "" CACHE FILEPATH
	"Prebuilt palot-opencode-sidecar executable (otherwise built with Bun)")

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
			src/opencode_process.cpp
			src/palot_view.cpp
		APP_NAME "Palot"
		BUNDLE_ID "com.palot.burl"
		VERSION "0.1.0")
	target_link_libraries(burl-palot PRIVATE nlohmann_json::nlohmann_json)

	set(PALOT_SIDECAR_NAME "palot-opencode-sidecar")
	set(PALOT_SIDECAR_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/sidecar")
	set(PALOT_SIDECAR_OUTPUT "${PALOT_SIDECAR_BUILD_DIR}/${PALOT_SIDECAR_NAME}")
	set(PALOT_REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

	if(PALOT_OPENCODE_SIDECAR_EXECUTABLE)
		if(NOT IS_ABSOLUTE "${PALOT_OPENCODE_SIDECAR_EXECUTABLE}" OR
			NOT EXISTS "${PALOT_OPENCODE_SIDECAR_EXECUTABLE}")
			message(FATAL_ERROR
				"PALOT_OPENCODE_SIDECAR_EXECUTABLE must name an existing absolute file")
		endif()
		add_custom_command(OUTPUT "${PALOT_SIDECAR_OUTPUT}"
			COMMAND "${CMAKE_COMMAND}" -E make_directory "${PALOT_SIDECAR_BUILD_DIR}"
			COMMAND "${CMAKE_COMMAND}" -E copy
				"${PALOT_OPENCODE_SIDECAR_EXECUTABLE}" "${PALOT_SIDECAR_OUTPUT}"
			DEPENDS "${PALOT_OPENCODE_SIDECAR_EXECUTABLE}"
			VERBATIM)
	else()
		find_program(PALOT_BUN_EXECUTABLE bun HINTS "$ENV{HOME}/.bun/bin")
		if(NOT PALOT_BUN_EXECUTABLE)
			message(FATAL_ERROR
				"Bun is required to compile the OpenCode sidecar; alternatively set "
				"PALOT_OPENCODE_SIDECAR_EXECUTABLE to a prebuilt absolute path")
		endif()
		file(GLOB_RECURSE PALOT_SIDECAR_SOURCES CONFIGURE_DEPENDS
			"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/src/*.ts"
			"${PALOT_REPOSITORY_ROOT}/packages/opencode/src/*.ts")
		add_custom_command(OUTPUT "${PALOT_SIDECAR_OUTPUT}"
			COMMAND "${CMAKE_COMMAND}" -E make_directory "${PALOT_SIDECAR_BUILD_DIR}"
			COMMAND "${PALOT_BUN_EXECUTABLE}" build --compile
				"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/src/main.ts"
				--outfile "${PALOT_SIDECAR_OUTPUT}"
			WORKING_DIRECTORY "${PALOT_REPOSITORY_ROOT}"
			DEPENDS ${PALOT_SIDECAR_SOURCES}
				"${PALOT_REPOSITORY_ROOT}/apps/opencode-sidecar/package.json"
				"${PALOT_REPOSITORY_ROOT}/packages/opencode/package.json"
				"${PALOT_REPOSITORY_ROOT}/bun.lock"
			COMMENT "Compiling self-contained OpenCode sidecar"
			VERBATIM)
	endif()

	add_custom_target(palot-opencode-sidecar DEPENDS "${PALOT_SIDECAR_OUTPUT}")
	add_dependencies(burl-palot palot-opencode-sidecar)
	target_include_directories(burl-palot PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/include")
	target_compile_definitions(burl-palot PRIVATE
		PALOT_OPENCODE_SIDECAR_RESOURCE_PATH="bin/${PALOT_SIDECAR_NAME}")

	add_custom_command(TARGET burl-palot POST_BUILD
		COMMAND "${CMAKE_COMMAND}" -E make_directory
			"$<TARGET_BUNDLE_DIR:burl-palot>/Contents/Resources/bin"
		COMMAND "${CMAKE_COMMAND}" -E copy "${PALOT_SIDECAR_OUTPUT}"
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
		add_test(NAME palot-opencode-process
			COMMAND palot-opencode-process-test
				"${CMAKE_CURRENT_SOURCE_DIR}/test/fake_sidecar.py"
				"${PALOT_SIDECAR_OUTPUT}")
	endif()
endif()
