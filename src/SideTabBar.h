#pragma once

#include <QTabBar>
#include <QWidget>

class QStackedWidget;
class QPushButton;
class QResizeEvent;
class QShowEvent;
class QSplitter;
class SessionsPanel;

/**
 * Left-side tab bar with horizontal, word-wrapped labels.
 *
 * Stock QTabBar rotates text 90 degrees for West/East positions, which is
 * unreadable for terminal tabs. This bar keeps a fixed width and lets each
 * tab grow taller as its (wrapped) label needs more lines. It draws its own
 * close button per tab; selection, hover, and drag-reorder stay stock.
 */
class SideTabBar : public QTabBar
{
    Q_OBJECT

public:
    explicit SideTabBar(QWidget *parent = nullptr);

    void setFixedTabWidth(int width);
    void setTopMode(bool on);
    static QString fittedLabel(const QFontMetrics &metrics,
                               const QString &text, int width);
    QSize minimumSizeHint() const override;

protected:
    QSize tabSizeHint(int index) const override;
    QSize minimumTabSizeHint(int index) const override;
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;

private:
    QRect closeButtonRect(int index) const;

    int m_fixedWidth = 180;
    bool m_topMode = false;
    static constexpr int kPad = 8;
    static constexpr int kCloseSize = 16;
};

/**
 * Left tab column: SideTabBar on top, new-tab button directly below it,
 * terminal pages in a QStackedWidget beside them. Replaces QTabWidget,
 * which gives no control over the strip layout (no way to dock a button
 * under the tabs or drop the bottom bar).
 */
class SideTabWidget : public QWidget
{
    Q_OBJECT

public:
    explicit SideTabWidget(QWidget *parent = nullptr);

    int addTab(QWidget *page, const QString &label);
    void removeTab(int index);
    void setCurrentIndex(int index);
    int currentIndex() const;
    int count() const;
    QWidget *widget(int index) const;
    QWidget *currentWidget() const;
    int indexOf(QWidget *page) const;
    QString tabText(int index) const;
    SessionsPanel *sessionsPanel() const;
    void updateLeftVisibility(bool sessionsVisible);
    void setTabsOnTop(bool on);
    bool tabsOnTop() const;
    QList<QPair<QWidget *, QString>> takePages();
    void addPage(QWidget *page, const QString &label);

signals:
    void tabCloseRequested(int index);
    void currentChanged(int index);
    void tabMoved(int from, int to);
    void newTabRequested();

private:
    SideTabBar *m_bar = nullptr;
    QStackedWidget *m_stack = nullptr;
    SessionsPanel *m_sessions = nullptr;
    QPushButton *m_addButton = nullptr;
    QWidget *m_left = nullptr;
    QWidget *m_barRow = nullptr;
    QWidget *m_content = nullptr;
    QSplitter *m_splitter = nullptr;
    bool m_topMode = false;
    bool m_firstShow = true;

    void applyLayout();
    bool applyPanelWidth(int width);
    void deferPanelWidth(int width);
    void relayout();
    void showEvent(QShowEvent *event) override;
    void savePanelWidth();
    int savedPanelWidth(int fallback) const;
};
