#include "MainWindow.h"
#include "SideTabBar.h"

#include <QDir>
#include <QDockWidget>
#include <QFontDatabase>
#include <QKeySequence>
#include <QPushButton>
#include <QShortcut>
#include <QTabWidget>
#include <QVBoxLayout>

#include "qtermwidget.h"

namespace
{
constexpr int kDefaultWidth = 1100;
constexpr int kDefaultHeight = 700;
constexpr int kHistorySize = 10000;
// Must match SideTabBar::m_fixedWidth so the new-tab button lines up
// exactly under the tab strip.
constexpr int kTabWidth = 180;
const char *const kDefaultShell = "/usr/bin/fish";
const char *const kColorScheme = "BreezeModified";
} // namespace

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setWindowTitle(tr("muis"));
    resize(kDefaultWidth, kDefaultHeight);

    setupTabs();
    setupSidebarSlot();

    auto *newTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_T), this);
    connect(newTabShortcut, &QShortcut::activated, this, &MainWindow::newTab);

    auto *closeTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_W), this);
    connect(closeTabShortcut, &QShortcut::activated, this, [this]() {
        closeTab(m_tabs->currentIndex());
    });

    newTab();
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

void MainWindow::newTab()
{
    auto *terminal = new QTermWidget(m_tabs);
    QFont terminalFont = QFontDatabase::systemFont(QFontDatabase::FixedFont);
    terminalFont.setPointSize(terminalFont.pointSize() + 1);
    terminal->setTerminalFont(terminalFont);
    terminal->setColorScheme(QLatin1String(kColorScheme));
    terminal->setShellProgram(QLatin1String(kDefaultShell));
    terminal->setWorkingDirectory(QDir::homePath());
    terminal->setHistorySize(kHistorySize);
    terminal->setMargin(5);
    terminal->setScrollBarPosition(QTermWidget::ScrollBarRight);

    connect(terminal, &QTermWidget::finished, this, &MainWindow::onTerminalFinished);

    const int index = m_tabs->addTab(terminal, tr("Terminal %1").arg(++m_tabCounter));
    m_tabs->setCurrentIndex(index);

    terminal->startShellProgram();
}

void MainWindow::closeTab(int index)
{
    if (index < 0 || m_tabs->count() <= 1) {
        return;
    }
    QWidget *page = m_tabs->widget(index);
    m_tabs->removeTab(index);
    delete page;
}

void MainWindow::onTerminalFinished()
{
    auto *terminal = qobject_cast<QTermWidget *>(sender());
    if (!terminal) {
        return;
    }
    const int index = m_tabs->indexOf(terminal);
    if (m_tabs->count() <= 1) {
        // Keep the window alive: replace the last tab with a fresh one.
        closeTab(index);
        if (m_tabs->count() == 0) {
            newTab();
        }
        return;
    }
    closeTab(index);
}

void MainWindow::setupTabs()
{
    m_tabs = new SideTabWidget(this);
    m_tabs->setTabPosition(QTabWidget::West);
    m_tabs->setMovable(true);
    m_tabs->setTabsClosable(false); // SideTabBar draws its own close buttons
    m_tabs->setDocumentMode(true);

    connect(m_tabs, &QTabWidget::tabCloseRequested, this, &MainWindow::closeTab);

    auto *central = new QWidget(this);
    auto *layout = new QVBoxLayout(central);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    layout->addWidget(m_tabs, 1);

    auto *newTabButton = new QPushButton(QStringLiteral("+"), central);
    newTabButton->setToolTip(tr("New tab (Ctrl+Shift+T)"));
    newTabButton->setFixedWidth(kTabWidth);
    newTabButton->setFixedHeight(36);
    newTabButton->setFlat(true);
    connect(newTabButton, &QPushButton::clicked, this, &MainWindow::newTab);
    layout->addWidget(newTabButton, 0, Qt::AlignLeft);

    setCentralWidget(central);
}

void MainWindow::setupSidebarSlot()
{
    m_sidebar = new QDockWidget(tr("Sidebar"), this);
    m_sidebar->setObjectName(QStringLiteral("sidebarSlot"));
    m_sidebar->setAllowedAreas(Qt::LeftDockWidgetArea);
    addDockWidget(Qt::LeftDockWidgetArea, m_sidebar);
    m_sidebar->hide(); // Reserved slot: empty until a panel registers.
}
