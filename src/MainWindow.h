#pragma once

#include <QMainWindow>

class QTabWidget;
class QDockWidget;

/**
 * muis main window.
 *
 * Owns the tab strip and per-tab terminal widgets. The emulation itself
 * lives upstream in qtermwidget; this class only manages chrome.
 *
 * The sidebar dock is a reserved extension slot (future panels: session
 * list, Snor assistant). It ships empty: no panel may be registered in v1,
 * and panels are thin IPC clients that never touch the network from this
 * process.
 */
class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

    /** Reserved extension slot. No callers in v1. */
    void addSidePanel(const QString &id, QWidget *panel);

private slots:
    void newTab();
    void closeTab(int index);
    void onTerminalFinished();

private:
    void setupTabs();
    void setupSidebarSlot();

    QTabWidget *m_tabs = nullptr;
    QDockWidget *m_sidebar = nullptr;
    int m_tabCounter = 0;
};
