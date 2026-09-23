#pragma once

#include <QTabBar>
#include <QTabWidget>

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

protected:
    QSize tabSizeHint(int index) const override;
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;

private:
    QRect closeButtonRect(int index) const;

    int m_fixedWidth = 180;
    static constexpr int kPad = 8;
    static constexpr int kCloseSize = 16;
};

/**
 * QTabWidget wired to SideTabBar. QTabWidget::setTabBar() is protected,
 * so this subclass exists only to install the custom bar. No signals or
 * slots of its own, deliberately Q_OBJECT-free.
 */
class SideTabWidget : public QTabWidget
{
public:
    explicit SideTabWidget(QWidget *parent = nullptr);
};
