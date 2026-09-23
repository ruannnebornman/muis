function(add_muis_test name)
  add_executable(${name} ${name}.cpp)
  target_link_libraries(${name} PRIVATE muis_lib Qt6::Test)
  add_test(NAME ${name} COMMAND ${name})
  # Headless by default (CI-safe); run without this env var to watch.
  set_tests_properties(${name} PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
endfunction()

add_muis_test(test_sessions)
add_muis_test(test_strip)
