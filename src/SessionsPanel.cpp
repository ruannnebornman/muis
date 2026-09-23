#include "SessionsPanel.h"

#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QFileDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenu>
#include <QPushButton>
#include <QStyle>
#include <QToolButton>
#include <QVBoxLayout>

SessionsPanel::SessionsPanel(QWidget *parent)
    : QWidget(parent)
{
    auto *header = new QHBoxLayout;
    header->setContentsMargins(4, 4, 4, 0);
    auto *title = new QLabel(tr("Sessions"), this);
    QFont titleFont = title->font();
    titleFont.setBold(true);
    title->setFont(titleFont);
    header->addWidget(title);
    header->addStretch(1);

    auto *addButton = new QToolButton(this);
    addButton->setText(QStringLiteral("+"));
    addButton->setToolTip(tr("Add session"));
    addButton->setAutoRaise(true);
    connect(addButton, &QToolButton::clicked, this, &SessionsPanel::addSession);
    header->addWidget(addButton);

    m_list = new QListWidget(this);
    m_list->setWordWrap(true);
    m_list->setMaximumHeight(220);
    // Width always follows the column (splitter/drag decides); long
    // folder paths wrap instead of forcing the column wide.
    m_list->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
    m_list->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(m_list, &QListWidget::itemClicked, this, [this](QListWidgetItem *item) {
        emit openRequested(m_list->row(item));
    });
    connect(m_list, &QListWidget::customContextMenuRequested,
            this, &SessionsPanel::showContextMenu);

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(2);
    layout->addLayout(header);
    layout->addWidget(m_list);
}

QSize SessionsPanel::sizeHint() const
{
    // Cap the width hint: long folder paths must wrap, never widen the
    // column. Dragging/saved widths still apply via the splitter state.
    QSize hint = QWidget::sizeHint();
    hint.setWidth(180);
    return hint;
}

void SessionsPanel::setExpanded(bool expanded)
{
    // Top mode: the list owns the full column height. Side mode: capped
    // so the tabs and + button keep their room below.
    m_list->setMaximumHeight(expanded ? QWIDGETSIZE_MAX : 220);
}

void SessionsPanel::setEntries(const QList<SessionEntry> &entries, int current)
{
    m_list->clear();
    const QStyle *style = this->style();
    for (const SessionEntry &entry : entries) {
        auto *item = new QListWidgetItem(
            style->standardIcon(entry.name == QLatin1String("home")
                                    ? QStyle::SP_DirHomeIcon
                                    : QStyle::SP_DirIcon),
            entry.name + QLatin1Char('\n') + entry.subtitle, m_list);
        item->setToolTip(entry.name);
    }
    m_list->setCurrentRow(current);
}

void SessionsPanel::addSession()
{
    QDialog dialog(this);
    dialog.setWindowTitle(tr("Add session"));

    auto *nameEdit = new QLineEdit(&dialog);
    auto *dirEdit = new QLineEdit(QDir::homePath(), &dialog);

    auto *browseButton = new QPushButton(tr("Browse..."), &dialog);
    connect(browseButton, &QPushButton::clicked, &dialog, [&]() {
        const QString dir = QFileDialog::getExistingDirectory(
            &dialog, tr("Session folder"), dirEdit->text());
        if (!dir.isEmpty()) {
            dirEdit->setText(dir);
        }
    });

    auto *dirRow = new QHBoxLayout;
    dirRow->addWidget(dirEdit, 1);
    dirRow->addWidget(browseButton);

    auto *form = new QFormLayout(&dialog);
    form->addRow(tr("Name:"), nameEdit);
    form->addRow(tr("Folder:"), dirRow);

    auto *buttons = new QDialogButtonBox(
        QDialogButtonBox::Ok | QDialogButtonBox::Cancel, &dialog);
    form->addWidget(buttons);
    connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);

    if (dialog.exec() != QDialog::Accepted || nameEdit->text().trimmed().isEmpty()) {
        return;
    }
    QString dir = dirEdit->text().trimmed();
    if (dir.isEmpty() || !QDir(dir).exists()) {
        dir = QDir::homePath();
    }
    emit addRequested(nameEdit->text().trimmed(), dir);
}

void SessionsPanel::showContextMenu(const QPoint &pos)
{
    QListWidgetItem *item = m_list->itemAt(pos);
    if (!item) {
        return;
    }
    const int row = m_list->row(item);
    QMenu menu(this);
    QAction *removeAction = menu.addAction(tr("Remove session"));
    if (menu.exec(m_list->mapToGlobal(pos)) == removeAction) {
        emit removeRequested(row);
    }
}
