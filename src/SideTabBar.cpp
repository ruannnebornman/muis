#include "SideTabBar.h"

#include <QMouseEvent>
#include <QStyleOption>
#include <QStylePainter>
#include <climits>

SideTabBar::SideTabBar(QWidget *parent)
    : QTabBar(parent)
{
    setElideMode(Qt::ElideNone); // wrap instead of "..."
}

void SideTabBar::setFixedTabWidth(int width)
{
    m_fixedWidth = width;
    updateGeometry();
}

QSize SideTabBar::tabSizeHint(int index) const
{
    // All tabs share the emphasized label style; only the selected tab's
    // background block differs (see paintEvent).
    QFont labelFont = font();
    labelFont.setBold(true);
    labelFont.setPointSize(labelFont.pointSize() + 1);
    const int textWidth = m_fixedWidth - kPad * 2 - kCloseSize - kPad;
    const QRect bounds = QFontMetrics(labelFont).boundingRect(
        QRect(0, 0, qMax(textWidth, 32), INT_MAX),
        Qt::TextWordWrap, tabText(index));
    const int height = qMax(bounds.height() + kPad * 2, kCloseSize + kPad * 2);
    return QSize(m_fixedWidth, height);
}

void SideTabBar::paintEvent(QPaintEvent * /*event*/)
{
    QStylePainter p(this);
    const QColor selectedBg(QStringLiteral("#8f4b28"));
    const QColor selectedFg(QStringLiteral("#ffe4ad"));
    for (int i = 0; i < count(); ++i) {
        const bool selected = (i == currentIndex());
        if (selected) {
            const QRect block = tabRect(i).adjusted(2, 2, -2, -2);
            p.save();
            p.setRenderHint(QPainter::Antialiasing);
            p.setPen(Qt::NoPen);
            p.setBrush(selectedBg);
            p.drawRoundedRect(block, 4, 4);
            p.restore();
        } else {
            QStyleOptionTab opt;
            initStyleOption(&opt, i);
            p.drawControl(QStyle::CE_TabBarTabShape, opt);
        }

        const QRect r = tabRect(i);
        const QRect textRect = r.adjusted(kPad, kPad, -(kPad + kCloseSize + kPad), -kPad);
        p.save();
        QFont labelFont = p.font();
        labelFont.setBold(true);
        labelFont.setPointSize(labelFont.pointSize() + 1);
        p.setFont(labelFont);
        if (selected) {
            p.setPen(selectedFg);
        }
        p.drawText(textRect, Qt::TextWordWrap | Qt::AlignLeft | Qt::AlignVCenter, tabText(i));
        p.restore();

        QStyleOption closeOpt;
        closeOpt.rect = closeButtonRect(i);
        closeOpt.state = QStyle::State_Enabled;
        p.drawPrimitive(QStyle::PE_IndicatorTabClose, closeOpt);
    }
}

void SideTabBar::mousePressEvent(QMouseEvent *event)
{
    if (event->button() == Qt::LeftButton) {
        for (int i = 0; i < count(); ++i) {
            if (closeButtonRect(i).contains(event->pos())) {
                emit tabCloseRequested(i);
                return;
            }
        }
    }
    QTabBar::mousePressEvent(event);
}

QRect SideTabBar::closeButtonRect(int index) const
{
    const QRect r = tabRect(index);
    const int y = r.center().y() - kCloseSize / 2;
    return QRect(r.right() - kPad - kCloseSize, y, kCloseSize, kCloseSize);
}

SideTabWidget::SideTabWidget(QWidget *parent)
    : QTabWidget(parent)
{
    setTabBar(new SideTabBar(this));
}
