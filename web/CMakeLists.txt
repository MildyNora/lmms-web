# The web build's module: LMMS's core and the plugins built for it, linked into one
# Emscripten module (lmms.js + lmms.wasm) whose entry point renders a project headless.
#
# Added to LMMS's own build by patches/0001 (LMMS_WEB_DIR), after the plugins, so the
# list of plugins built (PLUGINS_BUILT) is known here.

get_property(LMMS_WEB_PLUGINS GLOBAL PROPERTY PLUGINS_BUILT)
# Libraries other plugins use, built with BUILD_PLUGIN but without an entry point
list(REMOVE_ITEM LMMS_WEB_PLUGINS carlabase vstbase ZynAddSubFxCore)
# The LADSPA libraries linked in: those named here (as LADSPA files, without .so), out
# of the ones LMMS's build defines (LADSPA_LIBRARIES_BUILT, see patches/0005); all of
# them when empty. Only what is linked gets compiled.
set(LMMS_WEB_LADSPA "" CACHE STRING "LADSPA libraries to link into the web module (empty: all)")
get_property(LMMS_WEB_LADSPA_BUILT GLOBAL PROPERTY LADSPA_LIBRARIES_BUILT)
if(LMMS_WEB_LADSPA)
	string(REPLACE " " ";" LMMS_WEB_LADSPA_LIBRARIES "${LMMS_WEB_LADSPA}")
	foreach(library IN LISTS LMMS_WEB_LADSPA_LIBRARIES)
		if(NOT library IN_LIST LMMS_WEB_LADSPA_BUILT)
			message(FATAL_ERROR "LADSPA library ${library} isn't built (built: ${LMMS_WEB_LADSPA_BUILT})")
		endif()
	endforeach()
else()
	set(LMMS_WEB_LADSPA_LIBRARIES ${LMMS_WEB_LADSPA_BUILT})
endif()

# The registry of plugins and LADSPA libraries linked in (see PluginFactory, LadspaManager)
set(STATIC_PLUGIN_DECLARATIONS "")
set(STATIC_PLUGIN_ENTRIES "")
foreach(plugin IN LISTS LMMS_WEB_PLUGINS)
	string(APPEND STATIC_PLUGIN_DECLARATIONS
		"extern \"C\" Plugin::Descriptor ${plugin}_plugin_descriptor;\n"
		"extern \"C\" Plugin* ${plugin}_lmms_plugin_main(Model*, void*);\n")
	string(APPEND STATIC_PLUGIN_ENTRIES
		"\t{\"${plugin}\", &${plugin}_plugin_descriptor, &${plugin}_lmms_plugin_main},\n")
endforeach()
set(STATIC_LADSPA_DECLARATIONS "")
set(STATIC_LADSPA_ENTRIES "")
foreach(library IN LISTS LMMS_WEB_LADSPA_LIBRARIES)
	string(APPEND STATIC_LADSPA_DECLARATIONS
		"extern \"C\" const LADSPA_Descriptor* ${library}_ladspa_descriptor(unsigned long);\n")
	string(APPEND STATIC_LADSPA_ENTRIES "\t{\"${library}.so\", &${library}_ladspa_descriptor},\n")
endforeach()
configure_file(static_registry.cpp.in "${CMAKE_CURRENT_BINARY_DIR}/static_registry.cpp" @ONLY)

add_executable(lmms_web
	lmms_web_main.cpp
	"${CMAKE_CURRENT_BINARY_DIR}/static_registry.cpp"
)
target_include_directories(lmms_web PRIVATE
	"${CMAKE_SOURCE_DIR}/include"
	"${CMAKE_BINARY_DIR}"
	"${CMAKE_BINARY_DIR}/src"
)
target_compile_features(lmms_web PRIVATE cxx_std_20)
# The core's objects, with the libraries they need
target_static_libraries(lmms_web PRIVATE lmmsobjs)
target_link_libraries(lmms_web PRIVATE ${LMMS_WEB_PLUGINS} ${LMMS_WEB_LADSPA_LIBRARIES} ${QT_LIBRARIES})

# lmms.js (the loader, an ES module) and lmms.wasm, in <build>/web (LMMS's own lmms
# target, not built here, would also be lmms.js at the top of the build directory)
set_target_properties(lmms_web PROPERTIES
	OUTPUT_NAME lmms
	SUFFIX ".js"
	RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
)

# LMMS's band-limited wavetables, so the engine loads them instead of computing them
# (LMMS_DATA_DIR is /lmms/data/ unless the page sets it)
target_link_options(lmms_web PRIVATE
	"SHELL:--embed-file ${CMAKE_SOURCE_DIR}/data/wavetables@/lmms/data/wavetables"
)

# Emscripten's settings for the module. They go last on the link line (as link
# libraries rather than link options) so they win over the defaults Qt's targets add.
set(LMMS_WEB_EXPORTED_FUNCTIONS _main _malloc _free _lmms_init _lmms_render _lmms_version)
list(JOIN LMMS_WEB_EXPORTED_FUNCTIONS "," LMMS_WEB_EXPORTED_FUNCTIONS)
target_link_libraries(lmms_web PRIVATE
	# Qt for WebAssembly's core uses embind (emscripten::val); qt_add_executable would add it
	"-lembind"
	"-sMODULARIZE=1"
	"-sEXPORT_ES6=1"
	"-sEXPORT_NAME=createLmms"
	"-sENVIRONMENT=web,worker,node"
	"-sINVOKE_RUN=0"
	"-sEXIT_RUNTIME=0"
	"-sFORCE_FILESYSTEM=1"
	"-sALLOW_MEMORY_GROWTH=1"
	"-sINITIAL_MEMORY=64MB"
	"-sMAXIMUM_MEMORY=4GB"
	"-sSTACK_SIZE=5MB"
	"-sEXPORTED_FUNCTIONS=${LMMS_WEB_EXPORTED_FUNCTIONS}"
	"-sEXPORTED_RUNTIME_METHODS=FS,ENV,ccall,cwrap,callMain,UTF8ToString,stringToUTF8,lengthBytesUTF8"
)
