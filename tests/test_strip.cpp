// Browser-style UI tests for the tab strip: geometry, button tracking,
// top mode, splitter dragging. Real widgets, real mouse events.
#include <QtTest>

#include <QFont>
#include <QFontMetrics>
#include <QListWidget>
#include <QPushButton>
#include <QSettings>
#include <QSplitter>
#include <QTemporaryDir>

#include "SessionsPanel.h"
#include "SideTabBar.h"

class TestStrip : public QObject
{
    Q_OBJECT

private slots:
    void initTestCase()
    {
        qputenv("XDG_CONFIG_HOME", m_configDir.path().toLocal8Bit());
        QCoreApplication::setOrganizationName(QStringLiteral("Veldmuis"));
        QCoreApplication::setApplicationName(QStringLiteral("muis-test"));
    }

    void tabHeightsStayUniform()
    {
        SideTabWidget strip;
        strip.resize(1100, 700);
        strip.show();
        QVERIFY(QTest::qWaitForWindowExposed(&strip, 5000));

        strip.addTab(new QWidget, QStringLiteral("Terminal 1"));
        strip.addTab(new QWidget, QStringLiteral("Terminal 2"));
        QTest::qWait(100);
        auto *bar = strip.findChild<SideTabBar *>();
        const int twoTabHeight = bar->tabRect(0).height();

        for (int i = 3; i <= 10; ++i) {
            strip.addTab(new QWidget, QStringLiteral("Terminal %1").arg(i));
        }
        QTest::qWait(100);
        QCOMPARE(bar->tabRect(0).height(), twoTabHeight);
    }

    void addButtonTracksStripSynchronously()
    {
        SideTabWidget strip;
        strip.resize(1100, 700);
        strip.show();
        QVERIFY(QTest::qWaitForWindowExposed(&strip, 5000));
        strip.addTab(new QWidget, QStringLiteral("Terminal 1"));
        QTest::qWait(100);

        auto *bar = strip.findChild<SideTabBar *>();
        auto *button = strip.findChild<QPushButton *>();
        // No event-loop wait: geometry must be correct synchronously.
        strip.addTab(new QWidget, QStringLiteral("Terminal 2"));
        QCOMPARE(button->y(), bar->y() + bar->height() + 4);
    }

    void topModeKeepsPanelNarrow()
    {
        SideTabWidget strip;
        strip.resize(1100, 700);
        strip.show();
        QVERIFY(QTest::qWaitForWindowExposed(&strip, 5000));

        // Long folder paths like real sessions must not widen the column.
        strip.sessionsPanel()->setEntries(
            {{"home", "/home/kaazrot"},
             {"veldmuis",
              "/home/kaazrot/Documents/code/veldmuis/packages/veldmuis-terminal"}},
            0);
        strip.addTab(new QWidget, QStringLiteral("Terminal 1"));
        strip.setTabsOnTop(true);
        QTest::qWait(500);

        auto *left = strip.findChild<QWidget *>(QStringLiteral("leftPanel"));
        QVERIFY2(left->width() < 300,
                 qPrintable(QStringLiteral("left panel took %1px").arg(left->width())));
    }

    void topModeShortLabelNotElided()
    {
        QFont labelFont;
        labelFont.setBold(true);
        labelFont.setPointSize(labelFont.pointSize() + 1);
        const QFontMetrics metrics(labelFont);
        // Fits: untouched, even if only just.
        QCOMPARE(SideTabBar::fittedLabel(metrics, QStringLiteral("Terminal 1"), 10000),
                 QStringLiteral("Terminal 1"));
        // Real overflow: ellipsized.
        const int fullWidth = metrics.horizontalAdvance(QStringLiteral("Terminal 1"));
        QVERIFY(SideTabBar::fittedLabel(metrics, QStringLiteral("Terminal 1"),
                                        fullWidth / 2)
                    .endsWith(QChar(0x2026)));

        // Integration: a lone tab rect leaves room for its own label.
        SideTabWidget strip;
        strip.resize(1100, 700);
        strip.show();
        QVERIFY(QTest::qWaitForWindowExposed(&strip, 5000));
        strip.addTab(new QWidget, QStringLiteral("Terminal 1"));
        strip.setTabsOnTop(true);
        QTest::qWait(300);
        auto *bar = strip.findChild<SideTabBar *>();
        QFont barFont = bar->font();
        barFont.setBold(true);
        barFont.setPointSize(barFont.pointSize() + 1);
        const int needed =
            QFontMetrics(barFont).horizontalAdvance(QStringLiteral("Terminal 1"));
        QVERIFY2(bar->tabRect(0).width() >= needed,
                 "tab rect narrower than its own label");
    }

    void sessionsListFillsColumnInTopMode()
    {
        SideTabWidget strip;
        strip.resize(1100, 700);
        strip.show();
        QVERIFY(QTest::qWaitForWindowExposed(&strip, 5000));
        strip.addTab(new QWidget, QStringLiteral("Terminal 1"));
        strip.setTabsOnTop(true);
        QTest::qWait(300);

        auto *left = strip.findChild<QWidget *>(QStringLiteral("leftPanel"));
        auto *list = strip.findChild<QListWidget *>();
        QVERIFY2(list->y() + list->height() >= left->height() - 8,
                 qPrintable(QStringLiteral("list bottom %1, column %2")
                                .arg(list->y() + list->height())
                                .arg(left->height())));
    }

    void splitterDragPersistsWidth()
    {
        SideTabWidget strip;
        strip.resize(1100, 700);
        strip.show();
        QVERIFY(QTest::qWaitForWindowExposed(&strip, 5000));
        strip.addTab(new QWidget, QStringLiteral("Terminal 1"));
        QTest::qWait(200);

        auto *left = strip.findChild<QWidget *>(QStringLiteral("leftPanel"));
        auto *splitter = strip.findChild<QSplitter *>();
        QVERIFY(splitter);
        const int before = left->width();

        QWidget *handle = splitter->handle(1);
        QVERIFY(handle);
        // QTest::mouseMove carries no buttons, which QSplitter ignores;
        // drive the held drag with explicit move events instead.
        const QPoint pressPos = handle->rect().center();
        QTest::mousePress(handle, Qt::LeftButton, Qt::NoModifier, pressPos);
        QTest::qWait(100);
        for (int step = 0; step < 5; ++step) {
            const QPoint pos = handle->rect().center() + QPoint(30, 0);
            QMouseEvent move(QEvent::MouseMove, pos, handle->mapToGlobal(pos),
                             Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
            QApplication::sendEvent(handle, &move);
            QTest::qWait(20);
        }
        QTest::mouseRelease(handle, Qt::LeftButton, Qt::NoModifier,
                            handle->rect().center());
        QTest::qWait(200);

        QVERIFY2(left->width() > before + 100,
                 qPrintable(QStringLiteral("drag moved %1 -> %2")
                                .arg(before)
                                .arg(left->width())));
        QSettings settings;
        QVERIFY(settings.value(QStringLiteral("panelWidthSide"), 0).toInt() > 0);
    }

private:
    QTemporaryDir m_configDir;
};

QTEST_MAIN(TestStrip)
#include "test_strip.moc"
