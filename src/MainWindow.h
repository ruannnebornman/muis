#pragma once

#include <QList>
#include <QMainWindow>
#include <QPair>
#include <QString>
#include <QStringList>

class QCloseEvent;
class QDockWidget;
class QTermWidget;
class QWidget;
class SideTabWidget;

/** One session: named place (folder) holding a set of terminals. Pages live
 *  either in the visible strip or stashed here (still running) while
 *  another session is shown. */
struct Workspace {
    QString name;
    QString dir;
    QList<QPair<QWidget *, QString>> live;
    QStringList cwds;
    int active = 0;
};

/**
 * muis main window.
 *
 * Owns the tab strip with one terminal per tab, grouped into sessions
 * (workspaces). Clicking a session shows its terminals; hidden sessions
 * keep running. Only manually closing a tab removes it; quitting always
 * resumes where you left off. View options (sessions panel, tabs on top)
 * persist in the user settings file.
 *
 * The emulation itself lives upstream in qtermwidget; this class only
 * manages chrome. The sidebar dock is a reserved extension slot (Snor
 * assistant): panels are thin IPC clients that never touch the network
 * from this process.
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
    void switchWorkspace(int index);
    void addWorkspace(const QString &name, const QString &dir);
    void removeWorkspace(int index);
    void closeTab(int index);
    void onTerminalFinished();

private:
    void setupTabs();
    void setupSidebarSlot();
    void setupMenuBar();
    QTermWidget *newTabAt(const QString &cwd);
    void openWorkspace(int index);
    void zoomCurrent(int delta);
    QTermWidget *createTerminal(const QString &cwd);
    QTermWidget *terminalAt(int index) const;
    QTermWidget *currentTerminal() const;
    bool tabIsBusy(QTermWidget *terminal) const;
    bool confirmCloseTab(int index) const;
    QString tabCwd(QTermWidget *terminal) const;
    QString sessionDir() const;
    void refreshSessionsPanel();
    void loadSettings();
    void saveSettings() const;
    void loadWorkspaces();
    void saveSessions();
    int countBusyAll() const;

    SideTabWidget *m_tabs = nullptr;
    QDockWidget *m_sidebar = nullptr;
    QList<Workspace> m_workspaces;
    int m_currentWorkspace = 0;
    int m_tabCounter = 0;
    bool m_showSessions = true;
    bool m_tabsOnTop = false;
};
