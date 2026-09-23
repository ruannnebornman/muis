#include "MainWindow.h"
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
#include <QSettings>
#include <QStandardPaths>

#include "qtermwidget.h"

namespace
{
constexpr int kDefaultWidth = 1100;
constexpr int kDefaultHeight = 700;
constexpr int kHistorySize = 10000;
const char *const kDefaultShell = "/usr/bin/fish";
const char *const kColorScheme = "MuisDark";
} // namespace

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setWindowTitle(tr("muis"));
    resize(kDefaultWidth, kDefaultHeight);

    setupTabs();
    setupSidebarSlot();
    setupMenuBar();

    restoreSessions();
}

void MainWindow::addSidePanel(const QString &id, QWidget *panel)
{
    Q_UNUSED(id);
    // Reserved extension slot: no panels registered in v1.
    // Future panels (session list, Snor assistant) attach here as thin
    // IPC clients. They must never perform network I/O in this process.
    m_sidebar->setWidget(panel);
    m_sidebar->show();
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    int busy = 0;
    for (int i = 0; i < m_tabs->count(); ++i) {
        if (tabIsBusy(terminalAt(i))) {
            ++busy;
        }
    }
    if (busy > 0) {
        const auto answer = QMessageBox::question(
            this, tr("Quit muis"),
            tr("%1 tab(s) still have running processes.\nQuit muis anyway?")
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
    newTabAt(QDir::homePath());
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
    // Shell already exited (e.g. user typed `exit`): no confirmation,
    // the tab is simply gone.
    auto *terminal = qobject_cast<QTermWidget *>(sender());
    if (!terminal) {
        return;
    }
    const int index = m_tabs->indexOf(terminal);
    if (index < 0) {
        return;
    }
    QWidget *page = m_tabs->widget(index);
    if (m_tabs->count() == 1) {
        // Shell already exited and this was the last tab: quit.
        // closeEvent() saves, so the session still resumes.
        close();
        return;
    }
    m_tabs->removeTab(index);
    delete page;
    saveSessions();
}

void MainWindow::newTabAt(const QString &cwd)
{
    // The PTY layer snapshots the process cwd (setWorkingDirectory() is
    // ignored on this path), so hold the target directory for the whole
    // create+spawn window.
    const QString target = cwd.isEmpty() ? QDir::homePath() : cwd;
    const QString previousDir = QDir::currentPath();
    QDir::setCurrent(target);

    auto *terminal = createTerminal(cwd);

    const int index = m_tabs->addTab(terminal, tr("Terminal %1").arg(++m_tabCounter));
    m_tabs->setCurrentIndex(index);

    terminal->startShellProgram();
    QDir::setCurrent(previousDir);
    terminal->setFocus();
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
    terminal->setWorkingDirectory(cwd.isEmpty() ? QDir::homePath() : cwd);
    terminal->setShellProgram(QLatin1String(kDefaultShell));
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

void MainWindow::saveSessions() const
{
    QSettings settings;
    settings.beginWriteArray(QStringLiteral("tabs"));
    for (int i = 0; i < m_tabs->count(); ++i) {
        settings.setArrayIndex(i);
        settings.setValue(QStringLiteral("cwd"), tabCwd(terminalAt(i)));
    }
    settings.endArray();
    settings.setValue(QStringLiteral("active"), m_tabs->currentIndex());
    settings.setValue(QStringLiteral("geometry"), saveGeometry());
}

void MainWindow::restoreSessions()
{
    QSettings settings;
    const QByteArray geometry =
        settings.value(QStringLiteral("geometry")).toByteArray();
    if (!geometry.isEmpty()) {
        restoreGeometry(geometry);
    }
    const int count = settings.beginReadArray(QStringLiteral("tabs"));
    if (count == 0) {
        settings.endArray();
        newTab();
        return;
    }
    for (int i = 0; i < count; ++i) {
        settings.setArrayIndex(i);
        newTabAt(settings.value(QStringLiteral("cwd")).toString());
    }
    settings.endArray();
    m_tabs->setCurrentIndex(
        qBound(0, settings.value(QStringLiteral("active"), 0).toInt(), count - 1));
    saveSessions();
}
