cmake_minimum_required(VERSION 3.16)

project(muis
  VERSION 0.1.0
  DESCRIPTION "muis terminal emulator for Veldmuis"
  LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)
find_package(qtermwidget6 REQUIRED)

add_executable(muis
  src/main.cpp
  src/MainWindow.cpp
  src/MainWindow.h
  src/SideTabBar.cpp
  src/SideTabBar.h
)

target_link_libraries(muis PRIVATE
  Qt6::Widgets
  qtermwidget6
)

target_compile_definitions(muis PRIVATE MUIS_VERSION="${PROJECT_VERSION}")

install(TARGETS muis RUNTIME DESTINATION bin)
install(FILES data/muis.desktop DESTINATION share/applications)
install(FILES data/icons/hicolor/512x512/apps/muis.png
  DESTINATION share/icons/hicolor/512x512/apps)
install(FILES data/color-schemes/MuisDark.colorscheme
  DESTINATION share/qtermwidget6/color-schemes)
