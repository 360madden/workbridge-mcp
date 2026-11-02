using System;
using System.Threading;
using System.Windows;

namespace Workbridge.ControlCenter;

public partial class App : System.Windows.Application
{
    private Mutex? _instanceMutex;
    private MainWindow? _mainWindow;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _instanceMutex = new Mutex(true, @"Local\Workbridge.ControlCenter.SingleInstance", out bool createdNew);
        if (!createdNew)
        {
            _instanceMutex.Dispose();
            _instanceMutex = null;
            Shutdown();
            return;
        }

        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        _mainWindow = new MainWindow();
        MainWindow = _mainWindow;
        if (!Array.Exists(e.Args, arg => string.Equals(arg, "--tray", StringComparison.OrdinalIgnoreCase)))
            _mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _mainWindow?.DisposeTray();
        _instanceMutex?.Dispose();
        base.OnExit(e);
    }
}
