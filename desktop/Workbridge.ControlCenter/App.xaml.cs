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
            // The mutex can become visible a moment before the first instance
            // publishes its restore signal. Retry briefly rather than losing the
            // activation on a nearly simultaneous second launch.
            for (var attempt = 0; attempt < 15; attempt++)
            {
                try
                {
                    using var signal = EventWaitHandle.OpenExisting(@"Local\Workbridge.ControlCenter.Restore");
                    signal.Set();
                    break;
                }
                catch (WaitHandleCannotBeOpenedException)
                {
                    if (attempt < 14) Thread.Sleep(50);
                }
            }
            _instanceMutex.Dispose();
            _instanceMutex = null;
            Shutdown();
            return;
        }

        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        // Publish the restore endpoint before constructing the window: the window
        // starts asynchronous status polling, and a concurrent launch must not
        // lose its restore request while the first instance initializes.
        _restoreSignal = new EventWaitHandle(false, EventResetMode.AutoReset,
            @"Local\Workbridge.ControlCenter.Restore");
        _mainWindow = new MainWindow();
        MainWindow = _mainWindow;
        _restoreRegistration = ThreadPool.RegisterWaitForSingleObject(_restoreSignal,
            (_, _) =>
            {
                if (Dispatcher.HasShutdownStarted || Dispatcher.HasShutdownFinished) return;
                try
                {
                    Dispatcher.BeginInvoke(() =>
                    {
                        if (!Dispatcher.HasShutdownStarted) _mainWindow?.RestoreFromSecondInstance();
                    });
                }
                catch (InvalidOperationException)
                {
                    // The dispatcher may exit between checking and enqueuing.
                }
            },
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
