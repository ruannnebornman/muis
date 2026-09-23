#include <QApplication>

#include "MainWindow.h"

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("muis"));
    app.setApplicationDisplayName(QStringLiteral("muis"));
    app.setOrganizationName(QStringLiteral("Veldmuis"));

    MainWindow window;
    window.show();

    return app.exec();
}
