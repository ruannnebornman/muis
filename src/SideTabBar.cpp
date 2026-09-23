#include "SideTabBar.h"

#include <QHBoxLayout>
#include <QMouseEvent>
#include <QPushButton>
#include <QStackedWidget>
#include <QStyleOption>
#include <QStylePainter>
#include <QVBoxLayout>
#include <climits>

SideTabBar::SideTabBar(QWidget *parent)
    : QTabBar(parent)
{
    setElideMode(Qt::ElideNone); // wrap instead of "..."
    // Never stretch tabs to fill the strip: every tab keeps its
    // content height no matter how many tabs are open.
    setExpanding(false);
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

QSize SideTabBar::minimumTabSizeHint(int index) const
{
    // Stock minimum reserves scroll-button space and pins the strip to a
    // fixed floor; tabs must never shrink below (or float above) content.
    return tabSizeHint(index);
}

QSize SideTabBar::minimumSizeHint() const
{
    // Stock QTabBar::minimumSizeHint() floors the strip well above content
    // (scroll-button reserve), which parks the + button mid-column. Floor
    // at the tallest single tab instead; overflow scrolls from there.
    QSize hint = sizeHint();
    int tallest = 0;
    for (int i = 0; i < count(); ++i) {
        tallest = qMax(tallest, tabSizeHint(i).height());
    }
    if (tallest > 0) {
        hint.setHeight(tallest);
    }
    return hint;
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
    : QWidget(parent)
{
    m_bar = new SideTabBar(this);
    m_bar->setShape(QTabBar::RoundedWest);
    m_bar->setMovable(true);
    m_stack = new QStackedWidget(this);

    auto *addButton = new QPushButton(QStringLiteral("+"), this);
    addButton->setToolTip(tr("New tab (Ctrl+T)"));
    addButton->setFixedHeight(32);
    addButton->setFlat(true);
    connect(addButton, &QPushButton::clicked, this, &SideTabWidget::newTabRequested);

    auto *left = new QWidget(this);
    left->setFixedWidth(180);
    auto *leftLayout = new QVBoxLayout(left);
    leftLayout->setContentsMargins(0, 0, 0, 0);
    leftLayout->setSpacing(4);
    leftLayout->addWidget(m_bar);
    leftLayout->addWidget(addButton);
    leftLayout->addStretch(1);

    auto *layout = new QHBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    layout->addWidget(left);
    layout->addWidget(m_stack, 1);

    connect(m_bar, &QTabBar::currentChanged, this, [this](int index) {
        m_stack->setCurrentIndex(index);
        emit currentChanged(index);
    });
    connect(m_bar, &QTabBar::tabCloseRequested, this, &SideTabWidget::tabCloseRequested);
    connect(m_bar, &QTabBar::tabMoved, this, [this](int from, int to) {
        QWidget *current = m_stack->currentWidget();
        QWidget *moved = m_stack->widget(from);
        m_stack->removeWidget(moved);
        m_stack->insertWidget(to, moved);
        m_stack->setCurrentWidget(current);
        emit tabMoved(from, to);
    });
}

int SideTabWidget::addTab(QWidget *page, const QString &label)
{
    const int index = m_bar->addTab(label);
    m_stack->addWidget(page);
    relayout();
    return index;
}

void SideTabWidget::removeTab(int index)
{
    QWidget *page = m_stack->widget(index);
    m_stack->removeWidget(page);
    m_bar->removeTab(index);
    relayout();
}

void SideTabWidget::relayout()
{
    // Invalidate bottom-up: the outer layout alone reuses the left
    // panel's cached hint, which is exactly the one-frame lag.
    m_bar->updateGeometry();
    if (QWidget *left = m_bar->parentWidget()) {
        left->updateGeometry();
        if (left->layout()) {
            left->layout()->invalidate();
            left->layout()->activate();
        }
    }
    if (layout()) {
        layout()->invalidate();
        layout()->activate();
    }
}

void SideTabWidget::setCurrentIndex(int index)
{
    m_bar->setCurrentIndex(index);
}

int SideTabWidget::currentIndex() const
{
    return m_bar->currentIndex();
}

int SideTabWidget::count() const
{
    return m_bar->count();
}

QWidget *SideTabWidget::widget(int index) const
{
    return m_stack->widget(index);
}

QWidget *SideTabWidget::currentWidget() const
{
    return m_stack->currentWidget();
}

int SideTabWidget::indexOf(QWidget *page) const
{
    return m_stack->indexOf(page);
}

QString SideTabWidget::tabText(int index) const
{
    return m_bar->tabText(index);
}
