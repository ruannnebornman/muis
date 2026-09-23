#pragma once

#include <QList>
#include <QString>
#include <QWidget>

struct SessionEntry {
    QString name;
    QString subtitle; // e.g. "3 tabs"
};

class QListWidget;

/**
 * Workspace switcher docked above the tab strip. Clicking an entry shows
 * that session's terminals (they keep running while hidden); "+" adds a
 * session; right-click removes one. Display-only: MainWindow owns the data
 * and pushes it via setEntries().
 */
class SessionsPanel : public QWidget
{
    Q_OBJECT

public:
    explicit SessionsPanel(QWidget *parent = nullptr);

    void setEntries(const QList<SessionEntry> &entries, int current);
    void setExpanded(bool expanded);
    QSize sizeHint() const override;
signals:
    void openRequested(int index);
    void addRequested(const QString &name, const QString &dir);
    void removeRequested(int index);

private slots:
    void addSession();
    void showContextMenu(const QPoint &pos);

private:
    QListWidget *m_list = nullptr;
};
