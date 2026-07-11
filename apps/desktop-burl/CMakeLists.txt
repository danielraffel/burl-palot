cmake_minimum_required(VERSION 3.25)
project(burl_palot LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(BURL_PALOT_ENABLE_FRAMEWORK "Resolve the immutable Burl SDK and build Palot" ON)
set(BURL_SOURCE_DIR "" CACHE PATH "Explicit local Burl checkout override (development only)")

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
		SOURCES src/main.cpp
		APP_NAME "Palot"
		BUNDLE_ID "com.palot.burl"
		VERSION "0.1.0")
endif()
