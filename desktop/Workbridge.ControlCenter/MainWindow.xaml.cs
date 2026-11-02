using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Forms = System.Windows.Forms;

namespace Workbridge.ControlCenter;

public partial class MainWindow : Window
{
    private readonly Forms.NotifyIcon _trayIcon;
    private readonly CancellationTokenSource _stop = new();
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
        _ = PollStatusAsync(_stop.Token);
    }

    private static string RepoRoot()
    {
        // Executable is normally desktop/Workbridge.ControlCenter/bin/{configuration}/net10.0-windows.
        // Walk upwards to locate the checked-in probe; do not infer a fixed drive or user profile.
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "scripts", "desktop-status.mjs")))
                return directory.FullName;
            directory = directory.Parent;
        }
        throw new FileNotFoundException("Workbridge desktop-status.mjs was not found in an ancestor directory.");
    }

    private async Task PollStatusAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "node.exe",
                        WorkingDirectory = RepoRoot(),
                        Arguments = "scripts/desktop-status.mjs",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = false
                    }
                };
                process.Start();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(15));
                string output;
                try
                {
                    output = await process.StandardOutput.ReadToEndAsync(timeout.Token);
                    await process.WaitForExitAsync(timeout.Token);
                }
                catch (OperationCanceledException)
                {
                    try
                    {
                        if (!process.HasExited) process.Kill(entireProcessTree: true);
                    }
                    catch (InvalidOperationException) { /* Process already exited. */ }
                    catch (System.ComponentModel.Win32Exception) { /* Process already exited or inaccessible. */ }
                    throw;
                }
                if (process.ExitCode != 0) throw new InvalidOperationException("Local Workbridge status unavailable.");
                using var json = JsonDocument.Parse(output);
                var data = json.RootElement;
                if (!data.GetProperty("ok").GetBoolean()) throw new InvalidOperationException("Local Workbridge status unavailable.");
                var capacity = data.GetProperty("capacity");
                ConnectionText.Text = "Connected · Tunnel ready: " + data.GetProperty("tunnelReady").GetBoolean();
                VersionText.Text = "Version: " + data.GetProperty("version").GetString();
                CapacityText.Text = $"Slots: {capacity.GetProperty("occupied").GetInt32()} / {capacity.GetProperty("limit").GetInt32()} occupied";
                JobsText.Text = "Running jobs: " + data.GetProperty("runningJobs").GetInt32();
                SampleText.Text = "Last sample: " + data.GetProperty("sampledUtc").GetString();
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception)
            {
                ConnectionText.Text = "Disconnected / status unavailable";
                VersionText.Text = "Version: —";
                CapacityText.Text = "Slots: —";
                JobsText.Text = "Running jobs: —";
                SampleText.Text = "Last sample: unavailable";
            }
            try { await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
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
        _stop.Cancel();
        Close();
        System.Windows.Application.Current.Shutdown();
    }

    public void DisposeTray()
    {
        _stop.Cancel();
        _trayIcon.Visible = false;
        _trayIcon.ContextMenuStrip?.Dispose();
        _trayIcon.Dispose();
        // The asynchronous poll loop may still be unwinding; dispose its token source
        // only after it has finished, rather than racing cancellation callbacks.
    }
}
