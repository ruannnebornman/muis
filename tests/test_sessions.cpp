// Browser-style UI tests for muis sessions: real widgets, real mouse
// clicks, real fish shells. Run headless via ctest (offscreen) or headed
// by clearing QT_QPA_PLATFORM to watch.
#include <QtTest>

#include <QListWidget>
#include <QSettings>
#include <QTemporaryDir>
#include <unistd.h>

#include "MainWindow.h"
#include "SessionsPanel.h"
#include "SideTabBar.h"
#include "qtermwidget.h"

namespace
{
QString shellCwd(QTermWidget *terminal)
{
    char link[64];
    char target[1024];
    std::snprintf(link, sizeof(link), "/proc/%d/cwd", terminal->getShellPID());
    const ssize_t n = readlink(link, target, sizeof(target) - 1);
    if (n <= 0) {
        return {};
    }
    target[n] = '\0';
    return QString::fromLocal8Bit(target);
}

int terminalCount(MainWindow &window)
{
    return window.findChildren<QTermWidget *>().size();
}

void clickSessionRow(MainWindow &window, int row)
{
    auto *list = window.findChild<QListWidget *>();
    QVERIFY2(list, "sessions list not found");
    const QPoint pos = list->visualItemRect(list->item(row)).center();
    QTest::mouseClick(list->viewport(), Qt::LeftButton, Qt::NoModifier, pos);
}
} // namespace

class TestSessions : public QObject
{
    Q_OBJECT

private slots:
    void initTestCase()
    {
        qputenv("XDG_CONFIG_HOME", m_configDir.path().toLocal8Bit());
        QCoreApplication::setOrganizationName(QStringLiteral("Veldmuis"));
        QCoreApplication::setApplicationName(QStringLiteral("muis-test"));
    }

    void init()
    {
        QSettings settings;
        settings.clear();
    }

    // Regression: opening a dormant multi-tab session used to iterate the
    // saved tab list while each spawn saved (clearing) it mid-loop.
    void dormantSessionOpensEachTabInItsFolder()
    {
        {
            QSettings seed;
            seed.beginWriteArray(QStringLiteral("workspaces"));
            seed.setArrayIndex(0);
            seed.setValue(QStringLiteral("name"), QStringLiteral("main"));
            seed.setValue(QStringLiteral("tabs"), QStringList{
                QStringLiteral("/tmp"), QStringLiteral("/home/kaazrot"),
                QStringLiteral("/")});
            seed.setValue(QStringLiteral("activeTab"), 0);
            seed.setArrayIndex(1);
            seed.setValue(QStringLiteral("name"), QStringLiteral("other"));
            seed.endArray();
            seed.setValue(QStringLiteral("activeWorkspace"), 0);
            seed.sync();
        }

        MainWindow window;
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window, 5000));
        QTRY_COMPARE_WITH_TIMEOUT(terminalCount(window), 3, 10000);

        QStringList cwds;
        for (auto *terminal : window.findChildren<QTermWidget *>()) {
            cwds.append(shellCwd(terminal));
        }
        cwds.sort();
        QCOMPARE(cwds, (QStringList{QStringLiteral("/"), QStringLiteral("/home/kaazrot"),
                                   QStringLiteral("/tmp")}));
    }

    void rapidSessionSwitchingSurvives()
    {
        {
            QSettings seed;
            seed.beginWriteArray(QStringLiteral("workspaces"));
            seed.setArrayIndex(0);
            seed.setValue(QStringLiteral("name"), QStringLiteral("one"));
            seed.setValue(QStringLiteral("tabs"), QStringList{QStringLiteral("/tmp")});
            seed.setArrayIndex(1);
            seed.setValue(QStringLiteral("name"), QStringLiteral("two"));
            seed.setValue(QStringLiteral("tabs"), QStringList{QStringLiteral("/")});
            seed.endArray();
            seed.setValue(QStringLiteral("activeWorkspace"), 0);
            seed.sync();
        }

        MainWindow window;
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window, 5000));
        QTRY_COMPARE_WITH_TIMEOUT(terminalCount(window), 1, 10000);

        // Twenty real mouse clicks across sessions (the original crash).
        // Both shells must survive: visible + stashed. Switches defer a
        // tick, so pump before asserting.
        for (int i = 0; i < 10; ++i) {
            clickSessionRow(window, 1);
            clickSessionRow(window, 0);
        }
        QTest::qWait(1000);
        QCOMPARE(terminalCount(window), 2);
        auto *list = window.findChild<QListWidget *>();
        QCOMPARE(list->currentRow(), 0);
    }

    void tabsPersistAcrossRestart()
    {
        {
            QSettings seed;
            seed.beginWriteArray(QStringLiteral("workspaces"));
            seed.setArrayIndex(0);
            seed.setValue(QStringLiteral("name"), QStringLiteral("main"));
            seed.setValue(QStringLiteral("tabs"), QStringList{
                QStringLiteral("/tmp"), QStringLiteral("/")});
            seed.endArray();
            seed.setValue(QStringLiteral("activeWorkspace"), 0);
            seed.sync();
        }

        {
            MainWindow first;
            first.show();
            QVERIFY(QTest::qWaitForWindowExposed(&first, 5000));
            QTRY_COMPARE_WITH_TIMEOUT(terminalCount(first), 2, 10000);
            first.close();
        }

        MainWindow second;
        second.show();
        QVERIFY(QTest::qWaitForWindowExposed(&second, 5000));
        QTRY_COMPARE_WITH_TIMEOUT(terminalCount(second), 2, 10000);

        QStringList cwds;
        for (auto *terminal : second.findChildren<QTermWidget *>()) {
            cwds.append(shellCwd(terminal));
        }
        cwds.sort();
        QCOMPARE(cwds, (QStringList{QStringLiteral("/"), QStringLiteral("/tmp")}));
    }

private:
    QTemporaryDir m_configDir;
};

QTEST_MAIN(TestSessions)
#include "test_sessions.moc"
