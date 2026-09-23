#pragma once

#include <QMainWindow>

class QDockWidget;
class QTermWidget;
class SideTabWidget;

/**
 * muis main window.
 *
 * Owns the tab strip with one terminal per tab. The emulation itself
 * lives upstream in qtermwidget; this class only manages chrome.
 *
 * Tabs persist across restarts: only manually closing a tab removes it.
 * Quitting muis always resumes where you left off.
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

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void newTab();
    void closeTab(int index);
    void onTerminalFinished();

private:
    void setupTabs();
    void setupSidebarSlot();
    void setupMenuBar();
    void newTabAt(const QString &cwd);
    void zoomCurrent(int delta);
    QTermWidget *createTerminal(const QString &cwd);
    QTermWidget *terminalAt(int index) const;
    QTermWidget *currentTerminal() const;
    bool tabIsBusy(QTermWidget *terminal) const;
    bool confirmCloseTab(int index) const;
    QString tabCwd(QTermWidget *terminal) const;
    void saveSessions() const;
    void restoreSessions();

    SideTabWidget *m_tabs = nullptr;
    QDockWidget *m_sidebar = nullptr;
    int m_tabCounter = 0;
};
