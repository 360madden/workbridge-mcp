using System;
using System.Threading;
using System.Windows;

namespace Workbridge.ControlCenter;

public partial class App : System.Windows.Application
{
    private Mutex? _instanceMutex;
    private MainWindow? _mainWindow;
    private EventWaitHandle? _restoreSignal;
    private RegisteredWaitHandle? _restoreRegistration;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _instanceMutex = new Mutex(true, @"Local\Workbridge.ControlCenter.SingleInstance", out bool createdNew);
        if (!createdNew)
        {
            try
            {
                using var signal = EventWaitHandle.OpenExisting(@"Local\Workbridge.ControlCenter.Restore");
                signal.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                // The first instance is starting or shutting down.
            }
            _instanceMutex.Dispose();
            _instanceMutex = null;
            Shutdown();
            return;
        }

        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        _mainWindow = new MainWindow();
        MainWindow = _mainWindow;
        _restoreSignal = new EventWaitHandle(false, EventResetMode.AutoReset,
            @"Local\Workbridge.ControlCenter.Restore");
        _restoreRegistration = ThreadPool.RegisterWaitForSingleObject(_restoreSignal,
            (_, _) => Dispatcher.BeginInvoke(() => _mainWindow?.RestoreFromSecondInstance()),
            null, Timeout.Infinite, false);
        if (!Array.Exists(e.Args, arg => string.Equals(arg, "--tray", StringComparison.OrdinalIgnoreCase)))
            _mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _restoreRegistration?.Unregister(null);
        _restoreSignal?.Dispose();
        _mainWindow?.DisposeTray();
        _instanceMutex?.Dispose();
        base.OnExit(e);
    }
}
