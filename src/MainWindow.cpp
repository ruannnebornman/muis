#include "MainWindow.h"
#include "SessionsPanel.h"
#include "SideTabBar.h"

#include <QCloseEvent>
#include <QDesktopServices>
#include <QDir>
#include <QDockWidget>
#include <QFileInfo>
#include <QFontDatabase>
#include <QKeySequence>
#include <QMenuBar>
#include <QMessageBox>
#include <QPointer>
#include <QSettings>
#include <QStandardPaths>
#include <QTimer>
#include <QUrl>

#include "qtermwidget.h"

namespace
{
constexpr int kDefaultWidth = 1100;
constexpr int kDefaultHeight = 700;
constexpr int kHistorySize = 10000;
const char *const kDefaultShell = "/usr/bin/fish";
} // namespace

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setWindowTitle(tr("muis"));
    resize(kDefaultWidth, kDefaultHeight);

    setupTabs();
    setupSidebarSlot();
    setupMenuBar();

    auto *sessions = m_tabs->sessionsPanel();
    connect(sessions, &SessionsPanel::openRequested, this, [this](int index) {
        // Defer out of the list view's mouse handling: switching rebuilds
        // the session list, which deletes the clicked item while the view
        // is still using it (heap corruption, seen as a crash in
        // QListView::mouseReleaseEvent).
        QTimer::singleShot(0, this, [this, index]() { switchWorkspace(index); });
    });
    connect(sessions, &SessionsPanel::addRequested,
            this, &MainWindow::addWorkspace);
    connect(sessions, &SessionsPanel::removeRequested,
            this, &MainWindow::removeWorkspace);

    loadSettings();
    m_tabs->setTabsOnTop(m_tabsOnTop);
    m_tabs->updateLeftVisibility(m_showSessions);
    loadWorkspaces();
    openWorkspace(m_currentWorkspace);
}

void MainWindow::addSidePanel(const QString &id, QWidget *panel)
{
    Q_UNUSED(id);
    // Reserved extension slot: no panels registered in v1.
    // Future panels (Snor assistant) attach here as thin IPC clients.
    // They must never perform network I/O in this process.
    m_sidebar->setWidget(panel);
    m_sidebar->show();
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    const int busy = countBusyAll();
    if (busy > 0) {
        const auto answer = QMessageBox::question(
            this, tr("Quit muis"),
            tr("%1 terminal(s) still have running processes.\nQuit muis anyway?")
                .arg(busy),
            QMessageBox::Close | QMessageBox::Cancel, QMessageBox::Cancel);
        if (answer != QMessageBox::Close) {
            event->ignore();
            return;
        }
    }
    saveSessions();
    event->accept();
}

void MainWindow::newTab()
{
    newTabAt(sessionDir());
}

QString MainWindow::sessionDir() const
{
    if (m_currentWorkspace >= 0 && m_currentWorkspace < m_workspaces.size()) {
        const QString dir = m_workspaces.at(m_currentWorkspace).dir;
        if (!dir.isEmpty() && QDir(dir).exists()) {
            return dir;
        }
    }
    return QDir::homePath();
}

void MainWindow::switchWorkspace(int index)
{
    if (index < 0 || index >= m_workspaces.size() || index == m_currentWorkspace) {
        return;
    }
    // Stash the visible pages; their shells keep running while hidden.
    Workspace &current = m_workspaces[m_currentWorkspace];
    current.active = m_tabs->currentIndex();
    current.live = m_tabs->takePages();
    openWorkspace(index);
}

void MainWindow::addWorkspace(const QString &name, const QString &dir)
{
    if (name.isEmpty()) {
        return;
    }
    Workspace workspace;
    workspace.name = name;
    workspace.dir = (!dir.isEmpty() && QDir(dir).exists()) ? dir : QDir::homePath();
    m_workspaces.append(workspace);
    saveSessions();
    switchWorkspace(m_workspaces.size() - 1);
}

void MainWindow::removeWorkspace(int index)
{
    if (m_workspaces.size() <= 1 || index < 0 || index >= m_workspaces.size()) {
        return;
    }
    Workspace &workspace = m_workspaces[index];
    int busy = 0;
    const QList<QPair<QWidget *, QString>> pages =
        (index == m_currentWorkspace) ? m_tabs->takePages() : workspace.live;
    for (const auto &[page, label] : pages) {
        Q_UNUSED(label);
        if (tabIsBusy(qobject_cast<QTermWidget *>(page))) {
            ++busy;
        }
    }
    if (busy > 0) {
        const auto answer = QMessageBox::question(
            this, tr("Remove session"),
            tr("Session '%1' has %2 running terminal(s).\nRemove it anyway?")
                .arg(workspace.name).arg(busy),
            QMessageBox::Close | QMessageBox::Cancel, QMessageBox::Cancel);
        if (answer != QMessageBox::Close) {
            // Put the visible pages back; nothing changed.
            if (index == m_currentWorkspace) {
                for (const auto &[page, label] : pages) {
                    m_tabs->addPage(page, label);
                }
                m_tabs->setCurrentIndex(
                    qBound(0, workspace.active, m_tabs->count() - 1));
            }
            return;
        }
    }
    if (index == m_currentWorkspace) {
        for (const auto &[page, label] : pages) {
            Q_UNUSED(label);
            delete page;
        }
        m_workspaces.removeAt(index);
        m_currentWorkspace = qMin(index, m_workspaces.size() - 1);
        openWorkspace(m_currentWorkspace);
        return;
    }
    for (const auto &[page, label] : pages) {
        Q_UNUSED(label);
        delete page;
    }
    m_workspaces.removeAt(index);
    if (m_currentWorkspace > index) {
        --m_currentWorkspace;
    }
    refreshSessionsPanel();
    saveSessions();
}

void MainWindow::closeTab(int index)
{
    if (index < 0 || index >= m_tabs->count()) {
        return;
    }
    if (m_tabs->count() == 1) {
        // Last tab: closing it quits. closeEvent() confirms if busy
        // and saves, so don't confirm here (would ask twice).
        close();
        return;
    }
    if (tabIsBusy(terminalAt(index)) && !confirmCloseTab(index)) {
        return;
    }
    QWidget *page = m_tabs->widget(index);
    m_tabs->removeTab(index);
    delete page;
    saveSessions();
}

void MainWindow::onTerminalFinished()
{
    // Shell already exited (e.g. user typed `exit`): no confirmation.
    auto *terminal = qobject_cast<QTermWidget *>(sender());
    if (!terminal) {
        return;
    }
    const int index = m_tabs->indexOf(terminal);
    if (index >= 0) {
        if (m_tabs->count() == 1) {
            // Last tab: quit. closeEvent() saves, session still resumes.
            close();
            return;
        }
        QWidget *page = m_tabs->widget(index);
        m_tabs->removeTab(index);
        delete page;
        saveSessions();
        return;
    }
    // Hidden (stashed) shell exited: drop it from its workspace.
    for (Workspace &workspace : m_workspaces) {
        for (int i = 0; i < workspace.live.size(); ++i) {
            if (workspace.live.at(i).first == terminal) {
                workspace.live.removeAt(i);
                delete terminal;
                refreshSessionsPanel();
                saveSessions();
                return;
            }
        }
    }
}

QTermWidget *MainWindow::newTabAt(const QString &cwd)
{
    // The PTY layer snapshots the process cwd (setWorkingDirectory() is
    // ignored on this path), so hold the target directory for the whole
    // create+spawn window.
    const QString target = cwd.isEmpty() ? QDir::homePath() : cwd;
    const QString previousDir = QDir::currentPath();
    if (!QDir::setCurrent(target)) {
        QDir::setCurrent(QDir::homePath());
    }

    auto *terminal = createTerminal(cwd);

    const int index = m_tabs->addTab(terminal, tr("Terminal %1").arg(++m_tabCounter));
    m_tabs->setCurrentIndex(index);

    terminal->startShellProgram();
    QDir::setCurrent(previousDir);
    terminal->setFocus();
    saveSessions();
    return terminal;
}

void MainWindow::openWorkspace(int index)
{
    if (index < 0 || index >= m_workspaces.size()) {
        return;
    }
    m_currentWorkspace = index;
    Workspace &workspace = m_workspaces[index];
    if (!workspace.live.isEmpty()) {
        const QList<QPair<QWidget *, QString>> pages = workspace.live;
        workspace.live.clear();
        for (const auto &[page, label] : pages) {
            m_tabs->addPage(page, label);
        }
    } else if (!workspace.cwds.isEmpty()) {
        // Copy: newTabAt() saves mid-loop, which clears and rewrites this
        // very list (iterator invalidation -> crash in setWorkingDirectory).
        const QStringList cwds = workspace.cwds;
        for (const QString &cwd : cwds) {
            newTabAt(cwd);
        }
    } else {
        newTabAt(QDir::homePath());
    }
    m_tabs->setCurrentIndex(
        qBound(0, workspace.active, m_tabs->count() - 1));
    refreshSessionsPanel();
    saveSessions();
}

QTermWidget *MainWindow::createTerminal(const QString &cwd)
{
    auto *terminal = new QTermWidget(m_tabs);
    QFont terminalFont = QFontDatabase::systemFont(QFontDatabase::FixedFont);
    terminalFont.setPointSize(terminalFont.pointSize() + 1);
    terminal->setTerminalFont(terminalFont);
    // setColorScheme() only scans the widget's compiled-in scheme dir, so
    // resolve our shipped scheme to a full path (prefix-independent) and
    // pass that. Falls back to a dark stock scheme if not installed.
    const QString schemePath = QStandardPaths::locate(
        QStandardPaths::GenericDataLocation,
        QStringLiteral("qtermwidget6/color-schemes/MuisDark.colorscheme"));
    terminal->setColorScheme(
        schemePath.isEmpty() ? QLatin1String("Linux") : schemePath);
    terminal->setShellProgram(QLatin1String(kDefaultShell));
    terminal->setWorkingDirectory(cwd.isEmpty() ? QDir::homePath() : cwd);
    terminal->setHistorySize(kHistorySize);
    terminal->setMargin(5);
    terminal->setScrollBarPosition(QTermWidget::ScrollBarRight);

    connect(terminal, &QTermWidget::finished, this, &MainWindow::onTerminalFinished);
    return terminal;
}

void MainWindow::setupTabs()
{
    m_tabs = new SideTabWidget(this);

    connect(m_tabs, &SideTabWidget::tabCloseRequested, this, &MainWindow::closeTab);
    connect(m_tabs, &SideTabWidget::currentChanged, this, [this](int index) {
        if (auto *terminal = terminalAt(index)) {
            terminal->setFocus();
        }
        saveSessions();
    });
    connect(m_tabs, &SideTabWidget::tabMoved, this, [this]() { saveSessions(); });
    connect(m_tabs, &SideTabWidget::newTabRequested, this, &MainWindow::newTab);

    setCentralWidget(m_tabs);
}

void MainWindow::setupSidebarSlot()
{
    m_sidebar = new QDockWidget(tr("Sidebar"), this);
    m_sidebar->setObjectName(QStringLiteral("sidebarSlot"));
    m_sidebar->setAllowedAreas(Qt::LeftDockWidgetArea);
    addDockWidget(Qt::LeftDockWidgetArea, m_sidebar);
    m_sidebar->hide(); // Reserved slot: empty until a panel registers.
}

void MainWindow::setupMenuBar()
{
    auto *fileMenu = menuBar()->addMenu(tr("&File"));

    auto *newTabAction = fileMenu->addAction(tr("&New Tab"));
    newTabAction->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_T));
    connect(newTabAction, &QAction::triggered, this, &MainWindow::newTab);

    auto *closeTabAction = fileMenu->addAction(tr("&Close Tab"));
    closeTabAction->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_Q));
    connect(closeTabAction, &QAction::triggered, this, [this]() {
        closeTab(m_tabs->currentIndex());
    });

    // No Quit action: quitting is Alt+F4 (window manager), which flows
    // through closeEvent and therefore always confirms and saves.

    auto *viewMenu = menuBar()->addMenu(tr("&View"));

    auto *zoomInAction = viewMenu->addAction(tr("Zoom &In"));
    zoomInAction->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_Plus));
    connect(zoomInAction, &QAction::triggered, this, [this]() { zoomCurrent(1); });

    auto *zoomOutAction = viewMenu->addAction(tr("Zoom &Out"));
    zoomOutAction->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_Minus));
    connect(zoomOutAction, &QAction::triggered, this, [this]() { zoomCurrent(-1); });

    viewMenu->addSeparator();

    auto *sessionsAction = viewMenu->addAction(tr("&Sessions Panel"));
    sessionsAction->setCheckable(true);
    sessionsAction->setChecked(m_showSessions);
    connect(sessionsAction, &QAction::triggered, this, [this](bool checked) {
        m_showSessions = checked;
        m_tabs->updateLeftVisibility(checked);
        saveSettings();
    });

    auto *topTabsAction = viewMenu->addAction(tr("Tabs on &Top"));
    topTabsAction->setCheckable(true);
    topTabsAction->setChecked(m_tabsOnTop);
    connect(topTabsAction, &QAction::triggered, this, [this](bool checked) {
        m_tabsOnTop = checked;
        m_tabs->setTabsOnTop(checked);
        m_tabs->updateLeftVisibility(m_showSessions);
        saveSettings();
    });

    // Tab switching lives on Ctrl+Tab / Ctrl+Shift+Tab (no Tabs menu):
    // plain Tab must keep reaching the shell for completion.
    auto *nextTabAction = new QAction(this);
    nextTabAction->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_Tab));
    connect(nextTabAction, &QAction::triggered, this, [this]() {
        m_tabs->setCurrentIndex((m_tabs->currentIndex() + 1) % m_tabs->count());
    });
    addAction(nextTabAction);

    auto *prevTabAction = new QAction(this);
    prevTabAction->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Tab));
    connect(prevTabAction, &QAction::triggered, this, [this]() {
        m_tabs->setCurrentIndex((m_tabs->currentIndex() - 1 + m_tabs->count()) % m_tabs->count());
    });
    addAction(prevTabAction);

    auto *aboutMenu = menuBar()->addMenu(tr("&About"));

    auto *sourceAction = aboutMenu->addAction(tr("&Source"));
    connect(sourceAction, &QAction::triggered, this, []() {
        QDesktopServices::openUrl(QUrl(
            QStringLiteral("https://github.com/ruannnebornman/muis")));
    });

    auto *muisAction = aboutMenu->addAction(tr("&muis"));
    connect(muisAction, &QAction::triggered, this, [this]() {
        QMessageBox::about(this, tr("About muis"),
            tr("<h3>muis %1</h3>"
               "<p>Terminal emulator for Veldmuis.</p>"
               "<p>Source: <a href=\"https://github.com/ruannnebornman/muis\">"
               "github.com/ruannnebornman/muis</a></p>")
                .arg(QString::fromLatin1(MUIS_VERSION)));
    });
}

void MainWindow::zoomCurrent(int delta)
{
    auto *terminal = currentTerminal();
    if (!terminal) {
        return;
    }
    QFont font = terminal->getTerminalFont();
    const int size = qBound(6, font.pointSize() + delta, 24);
    font.setPointSize(size);
    terminal->setTerminalFont(font);
}

QTermWidget *MainWindow::terminalAt(int index) const
{
    return qobject_cast<QTermWidget *>(m_tabs->widget(index));
}

QTermWidget *MainWindow::currentTerminal() const
{
    return terminalAt(m_tabs->currentIndex());
}

bool MainWindow::tabIsBusy(QTermWidget *terminal) const
{
    if (!terminal) {
        return false;
    }
    const int shell = terminal->getShellPID();
    const int foreground = terminal->getForegroundProcessId();
    return shell > 0 && foreground > 0 && foreground != shell;
}

bool MainWindow::confirmCloseTab(int index) const
{
    const auto answer = QMessageBox::question(
        const_cast<MainWindow *>(this), tr("Close tab"),
        tr("%1 still has a running process.\nClose it anyway?")
            .arg(m_tabs->tabText(index)),
        QMessageBox::Close | QMessageBox::Cancel, QMessageBox::Cancel);
    return answer == QMessageBox::Close;
}

QString MainWindow::tabCwd(QTermWidget *terminal) const
{
    if (terminal) {
        // The shell's own cwd follows `cd` without needing shell
        // integration, so this stays correct for plain fish.
        const int pid = terminal->getShellPID();
        if (pid > 0) {
            const QString procCwd = QFileInfo(
                QStringLiteral("/proc/%1/cwd").arg(pid)).symLinkTarget();
            if (!procCwd.isEmpty() && QDir(procCwd).exists()) {
                return procCwd;
            }
        }
        const QString reported = terminal->workingDirectory();
        if (!reported.isEmpty()) {
            return reported;
        }
    }
    return QDir::homePath();
}

void MainWindow::refreshSessionsPanel()
{
    QList<SessionEntry> entries;
    for (int i = 0; i < m_workspaces.size(); ++i) {
        const Workspace &workspace = m_workspaces.at(i);
        entries.append({workspace.name, workspace.dir});
    }
    m_tabs->sessionsPanel()->setEntries(entries, m_currentWorkspace);
}

void MainWindow::loadSettings()
{
    // The user settings file: ~/.config/Veldmuis/muis.conf. View options
    // live here next to sessions so every toggle survives restarts.
    QSettings settings;
    m_showSessions = settings.value(QStringLiteral("showSessions"), true).toBool();
    m_tabsOnTop = settings.value(QStringLiteral("tabsOnTop"), false).toBool();
    const QByteArray geometry =
        settings.value(QStringLiteral("geometry")).toByteArray();
    if (!geometry.isEmpty()) {
        restoreGeometry(geometry);
    }
}

void MainWindow::saveSettings() const
{
    QSettings settings;
    settings.setValue(QStringLiteral("showSessions"), m_showSessions);
    settings.setValue(QStringLiteral("tabsOnTop"), m_tabsOnTop);
    settings.setValue(QStringLiteral("geometry"), saveGeometry());
}

void MainWindow::loadWorkspaces()
{
    QSettings settings;
    m_workspaces.clear();
    const int count = settings.beginReadArray(QStringLiteral("workspaces"));
    for (int i = 0; i < count; ++i) {
        settings.setArrayIndex(i);
        Workspace workspace;
        workspace.name = settings.value(QStringLiteral("name")).toString();
        workspace.dir = settings.value(QStringLiteral("dir")).toString();
        workspace.cwds =
            settings.value(QStringLiteral("tabs")).toStringList();
        workspace.active =
            settings.value(QStringLiteral("activeTab"), 0).toInt();
        if (workspace.dir.isEmpty() || !QDir(workspace.dir).exists()) {
            workspace.dir = QDir::homePath();
        }
        if (!workspace.name.isEmpty()) {
            m_workspaces.append(workspace);
        }
    }
    settings.endArray();
    if (m_workspaces.isEmpty()) {
        // One-time migration: old named sessions contribute names,
        // legacy open tabs contribute directories.
        QStringList names;
        const int oldCount = settings.beginReadArray(QStringLiteral("sessions"));
        for (int i = 0; i < oldCount; ++i) {
            settings.setArrayIndex(i);
            const QString name = settings.value(QStringLiteral("name")).toString();
            if (!name.isEmpty()) {
                names.append(name);
            }
        }
        settings.endArray();
        if (!names.isEmpty()) {
            for (const QString &name : names) {
                Workspace workspace;
                workspace.name = name;
                m_workspaces.append(workspace);
            }
        } else {
            Workspace workspace;
            workspace.name = tr("main");
            workspace.dir = QDir::homePath();
            const int tabCount = settings.beginReadArray(QStringLiteral("tabs"));
            for (int i = 0; i < tabCount; ++i) {
                settings.setArrayIndex(i);
                workspace.cwds.append(
                    settings.value(QStringLiteral("cwd")).toString());
            }
            settings.endArray();
            m_workspaces.append(workspace);
        }
        settings.remove(QStringLiteral("sessions"));
        settings.remove(QStringLiteral("tabs"));
        settings.remove(QStringLiteral("active"));
    }
    if (m_workspaces.isEmpty()) {
        Workspace workspace;
        workspace.name = tr("home");
        workspace.dir = QDir::homePath();
        m_workspaces.append(workspace);
    }
    m_currentWorkspace =
        qBound(0, settings.value(QStringLiteral("activeWorkspace"), 0).toInt(),
               m_workspaces.size() - 1);
}

void MainWindow::saveSessions()
{
    // Snapshot the visible strip, refresh dormant snapshots from live
    // stashed pages, then persist everything with the view settings.
    if (m_currentWorkspace >= 0 && m_currentWorkspace < m_workspaces.size()) {
        Workspace &current = m_workspaces[m_currentWorkspace];
        current.cwds.clear();
        for (int i = 0; i < m_tabs->count(); ++i) {
            current.cwds.append(tabCwd(terminalAt(i)));
        }
        current.active = m_tabs->currentIndex();
    }
    for (int i = 0; i < m_workspaces.size(); ++i) {
        if (i == m_currentWorkspace) {
            continue;
        }
        Workspace &workspace = m_workspaces[i];
        if (!workspace.live.isEmpty()) {
            workspace.cwds.clear();
            for (const auto &[page, label] : workspace.live) {
                Q_UNUSED(label);
                workspace.cwds.append(
                    tabCwd(qobject_cast<QTermWidget *>(page)));
            }
        }
    }
    QSettings settings;
    settings.beginWriteArray(QStringLiteral("workspaces"));
    for (int i = 0; i < m_workspaces.size(); ++i) {
        const Workspace &workspace = m_workspaces.at(i);
        settings.setArrayIndex(i);
        settings.setValue(QStringLiteral("name"), workspace.name);
        settings.setValue(QStringLiteral("dir"), workspace.dir);
        settings.setValue(QStringLiteral("tabs"), workspace.cwds);
        settings.setValue(QStringLiteral("activeTab"), workspace.active);
    }
    settings.endArray();
    settings.setValue(QStringLiteral("activeWorkspace"), m_currentWorkspace);
    settings.setValue(QStringLiteral("geometry"), saveGeometry());
    refreshSessionsPanel();
}

int MainWindow::countBusyAll() const
{
    int busy = 0;
    for (int i = 0; i < m_tabs->count(); ++i) {
        if (tabIsBusy(terminalAt(i))) {
            ++busy;
        }
    }
    for (const Workspace &workspace : m_workspaces) {
        for (const auto &[page, label] : workspace.live) {
            Q_UNUSED(label);
            if (tabIsBusy(qobject_cast<QTermWidget *>(page))) {
                ++busy;
            }
        }
    }
    return busy;
}
