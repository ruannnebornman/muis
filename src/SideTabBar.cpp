#include "SideTabBar.h"
#include "SessionsPanel.h"

#include <QSettings>
#include <QShowEvent>
#include <QSplitter>

#include <QHBoxLayout>
#include <QList>
#include <QMouseEvent>
#include <QPushButton>
#include <QResizeEvent>
#include <QStackedWidget>
#include <QStyleOption>
#include <QStylePainter>
#include <QTimer>
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

QString SideTabBar::fittedLabel(const QFontMetrics &metrics,
                                 const QString &text, int width)
{
    // Only elide on real overflow: hint/paint rounding must never cost
    // characters when the label fits.
    if (metrics.horizontalAdvance(text) <= width) {
        return text;
    }
    return metrics.elidedText(text, Qt::ElideRight, width);
}

void SideTabBar::setTopMode(bool on)
{
    if (m_topMode == on) {
        return;
    }
    m_topMode = on;
    updateGeometry();
    update();
}

void SideTabBar::resizeEvent(QResizeEvent *event)
{
    QTabBar::resizeEvent(event);
    // Tabs fill a dragged strip: track the bar width (side mode only;
    // top tabs size to content). Guarded, so it settles immediately.
    if (!m_topMode && event->size().width() != m_fixedWidth) {
        m_fixedWidth = event->size().width();
        updateGeometry();
    }
}

QSize SideTabBar::tabSizeHint(int index) const
{
    // All tabs share the emphasized label style; only the selected tab's
    // background block differs (see paintEvent).
    QFont labelFont = font();
    labelFont.setBold(true);
    labelFont.setPointSize(labelFont.pointSize() + 1);
    if (m_topMode) {
        // Top tabs size to content, single line; the bar scrolls on overflow.
        const QFontMetrics metrics(labelFont);
        const int textWidth = metrics.horizontalAdvance(tabText(index));
        return QSize(textWidth + kPad * 2 + kCloseSize + kPad,
                     qMax(metrics.height() + kPad * 2, kCloseSize + kPad * 2));
    }
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
    // at a single tab instead; overflow scrolls from there.
    QSize hint = sizeHint();
    int widest = 0;
    int tallest = 0;
    for (int i = 0; i < count(); ++i) {
        const QSize tabHint = tabSizeHint(i);
        widest = qMax(widest, tabHint.width());
        tallest = qMax(tallest, tabHint.height());
    }
    if (tallest > 0) {
        hint.setHeight(tallest);
    }
    if (m_topMode && widest > 0) {
        hint.setWidth(widest);
    } else if (!m_topMode) {
        hint.setWidth(80); // floor only; the strip drags wider freely
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
        if (m_topMode) {
            p.drawText(textRect,
                       Qt::AlignLeft | Qt::AlignVCenter | Qt::TextSingleLine,
                       fittedLabel(p.fontMetrics(), tabText(i),
                                   textRect.width()));
        } else {
            p.drawText(textRect,
                       Qt::TextWordWrap | Qt::AlignLeft | Qt::AlignVCenter,
                       tabText(i));
        }
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
    m_left = new QWidget(this);
    m_left->setObjectName(QStringLiteral("leftPanel"));
    m_left->setMinimumWidth(80);
    m_barRow = new QWidget(this);
    m_content = new QWidget(this);
    m_sessions = new SessionsPanel(m_left);
    m_sessions->setMinimumWidth(50);

    m_addButton = new QPushButton(QStringLiteral("+"), this);
    m_addButton->setToolTip(tr("New tab (Ctrl+T)"));
    m_addButton->setFlat(true);
    connect(m_addButton, &QPushButton::clicked, this, &SideTabWidget::newTabRequested);

    applyLayout();

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
    // Invalidate bottom-up: the outer layout alone reuses cached child
    // hints, which used to move the strip a frame late on add/remove.
    m_bar->updateGeometry();
    for (QWidget *w = m_bar; w; w = w->parentWidget()) {
        if (w->layout()) {
            w->layout()->invalidate();
            w->layout()->activate();
        }
        if (w == this) {
            break;
        }
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

SessionsPanel *SideTabWidget::sessionsPanel() const
{
    return m_sessions;
}

void SideTabWidget::updateLeftVisibility(bool sessionsVisible)
{
    // Side mode always needs the column (it holds the tabs). Top mode
    // only needs it for sessions: hide the whole column when they are off.
    m_sessions->setVisible(sessionsVisible);
    m_left->setVisible(sessionsVisible || !m_topMode);
    relayout();
}

void SideTabWidget::setTabsOnTop(bool on)
{
    if (m_topMode == on) {
        return;
    }
    m_topMode = on;
    m_bar->setTopMode(on);
    m_bar->setShape(on ? QTabBar::RoundedNorth : QTabBar::RoundedWest);
    applyLayout();
    // Reset to the default width on mode switch (restoring the other
    // mode's width misbehaves); dragging re-saves from here. Deferred:
    // the fresh splitter has no width until the layout runs.
    deferPanelWidth(180);
    QSettings settings;
    settings.setValue(m_topMode ? QStringLiteral("panelWidthTop")
                                : QStringLiteral("panelWidthSide"),
                      180);
}

bool SideTabWidget::tabsOnTop() const
{
    return m_topMode;
}

QList<QPair<QWidget *, QString>> SideTabWidget::takePages()
{
    // Detach every page without deleting; processes keep running while
    // their session is hidden. Callers re-attach via addPage().
    QList<QPair<QWidget *, QString>> pages;
    m_bar->blockSignals(true);
    while (count() > 0) {
        const int last = count() - 1;
        pages.prepend({m_stack->widget(last), m_bar->tabText(last)});
        m_stack->removeWidget(pages.first().first);
        m_bar->removeTab(last);
    }
    m_bar->blockSignals(false);
    relayout();
    return pages;
}

void SideTabWidget::addPage(QWidget *page, const QString &label)
{
    m_bar->blockSignals(true);
    m_bar->addTab(label);
    m_stack->addWidget(page);
    m_bar->blockSignals(false);
    relayout();
}

void SideTabWidget::applyLayout()
{
    // Pull our containers out of the old splitter (its handle widgets die
    // with it), drop all container layouts, then rebuild for the mode.
    if (m_splitter) {
        for (QWidget *w : QList<QWidget *>{m_left, m_stack, m_content}) {
            w->setParent(this);
        }
        delete m_splitter;
        m_splitter = nullptr;
    }
    // Drop the old outer layout: a widget holds one layout, and a second
    // setLayout is silently ignored (leaving the new splitter unmanaged).
    delete layout();
    for (QWidget *box : {m_left, m_barRow, m_content}) {
        if (QLayout *boxLayout = box->layout()) {
            while (boxLayout->takeAt(0)) {
            }
            delete boxLayout;
        }
    }
    m_bar->setShape(m_topMode ? QTabBar::RoundedNorth : QTabBar::RoundedWest);
    m_sessions->setExpanded(m_topMode);
    if (!m_topMode) {
        auto *leftLayout = new QVBoxLayout(m_left);
        leftLayout->setContentsMargins(0, 0, 0, 0);
        leftLayout->setSpacing(4);
        leftLayout->addWidget(m_sessions);
        leftLayout->addWidget(m_bar);
        m_addButton->setFixedHeight(32);
        leftLayout->addWidget(m_addButton);
        leftLayout->addStretch(1);

        m_splitter = new QSplitter(Qt::Horizontal, this);
        m_splitter->addWidget(m_left);
        m_splitter->addWidget(m_stack);
        m_barRow->hide();
        m_content->hide();
        m_left->show();
    } else {
        // Sessions column runs full height on the left; tabs on top of
        // the terminal column on the right.
        auto *rowLayout = new QHBoxLayout(m_barRow);
        rowLayout->setContentsMargins(4, 4, 4, 4);
        rowLayout->setSpacing(4);
        rowLayout->addWidget(m_bar, 1);
        m_addButton->setFixedWidth(48);
        m_addButton->setFixedHeight(28);
        rowLayout->addWidget(m_addButton);

        auto *leftLayout = new QVBoxLayout(m_left);
        leftLayout->setContentsMargins(0, 0, 0, 0);
        leftLayout->setSpacing(4);
        leftLayout->addWidget(m_sessions, 1);

        auto *rightLayout = new QVBoxLayout(m_content);
        rightLayout->setContentsMargins(0, 0, 0, 0);
        rightLayout->setSpacing(0);
        rightLayout->addWidget(m_barRow);
        rightLayout->addWidget(m_stack, 1);

        m_splitter = new QSplitter(Qt::Horizontal, this);
        m_splitter->addWidget(m_left);
        m_splitter->addWidget(m_content);
        m_barRow->show();
        m_content->show();
        m_left->show();
    }
    auto *outer = new QVBoxLayout(this);
    outer->setContentsMargins(0, 0, 0, 0);
    outer->setSpacing(0);
    outer->addWidget(m_splitter);
    m_splitter->setChildrenCollapsible(false);
    connect(m_splitter, &QSplitter::splitterMoved,
            this, &SideTabWidget::savePanelWidth);
    relayout();
    // After relayout so the new splitter has real width (setSizes needs
    // a non-zero total). No-op pre-show; showEvent covers first show.
    applyPanelWidth(savedPanelWidth(180));
}

void SideTabWidget::showEvent(QShowEvent *event)
{
    QWidget::showEvent(event);
    // Constructor-time sizing lands on zero width; re-apply once the
    // initial layout has run.
    if (m_firstShow) {
        m_firstShow = false;
        deferPanelWidth(savedPanelWidth(180));
    }
}

bool SideTabWidget::applyPanelWidth(int width)
{
    // Deferred callers (show, mode switch) land here once the new splitter
    // has real width. Returns false if there is nothing to size yet.
    if (!m_splitter) {
        return false;
    }
    if (layout()) {
        layout()->invalidate();
        layout()->activate();
    }
    const int total = m_splitter->width();
    if (total <= 0) {
        return false;
    }
    // NOTE: sizes must sum to the splitter width; a {width, 1} pair does
    // not mean "width plus the rest" and mis-sizes the panel.
    m_splitter->setSizes({width, total - width});
    return true;
}

void SideTabWidget::deferPanelWidth(int width)
{
    QTimer::singleShot(0, this, [this, width]() { applyPanelWidth(width); });
}

void SideTabWidget::savePanelWidth()
{    if (!m_splitter || m_splitter->sizes().isEmpty()) {
        return;
    }
    QSettings settings;
    settings.setValue(m_topMode ? QStringLiteral("panelWidthTop")
                                : QStringLiteral("panelWidthSide"),
                      m_splitter->sizes().first());
}

int SideTabWidget::savedPanelWidth(int fallback) const
{
    QSettings settings;
    return settings
        .value(m_topMode ? QStringLiteral("panelWidthTop")
                         : QStringLiteral("panelWidthSide"),
               fallback)
        .toInt();
}
