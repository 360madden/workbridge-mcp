using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows;
using Forms = System.Windows.Forms;

namespace Workbridge.ControlCenter;

public partial class MainWindow : Window
{
    private readonly Forms.NotifyIcon _trayIcon;
    private bool _exiting;

    public MainWindow()
    {
        InitializeComponent();
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Open dashboard", null, (_, _) => Dispatcher.Invoke(RestoreWindow));
        menu.Items.Add("Exit Control Center", null, (_, _) => Dispatcher.Invoke(ExitGui));

        _trayIcon = new Forms.NotifyIcon
        {
            Text = "Workbridge Control Center",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => Dispatcher.Invoke(RestoreWindow);
    }

    internal void RestoreFromSecondInstance() => RestoreWindow();

    private void RestoreWindow()
    {
        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_exiting) return;
        e.Cancel = true;
        Hide();
    }

    private void ExitGui()
    {
        _exiting = true;
        Close();
        System.Windows.Application.Current.Shutdown();
    }

    public void DisposeTray()
    {
        _trayIcon.Visible = false;
        _trayIcon.ContextMenuStrip?.Dispose();
        _trayIcon.Dispose();
    }
}
