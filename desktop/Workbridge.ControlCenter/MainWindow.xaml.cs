using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
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
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "scripts", "desktop-status.mjs")))
                return directory.FullName;
            directory = directory.Parent;
        }
        throw new FileNotFoundException("Workbridge probe scripts were not found in an ancestor directory.");
    }

    private static async Task<JsonDocument> RunProbeAsync(string scriptName, string? jobId,
        CancellationToken cancellationToken)
    {
        var root = RepoRoot();
        var script = Path.Combine(root, "scripts", scriptName);
        if (!File.Exists(script)) throw new FileNotFoundException("Required Workbridge probe not found.");
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "node.exe",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = false
            }
        };
        process.StartInfo.ArgumentList.Add(script);
        if (jobId is not null) process.StartInfo.ArgumentList.Add(jobId);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        process.Start();
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
            catch (InvalidOperationException) { }
            catch (Win32Exception) { }
            throw;
        }
        if (process.ExitCode != 0) throw new InvalidOperationException("Workbridge probe failed.");
        var json = JsonDocument.Parse(output);
        if (json.RootElement.GetProperty("ok").GetBoolean()) return json;
        json.Dispose();
        throw new InvalidOperationException("Workbridge probe returned an error.");
    }

    private async Task PollStatusAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var json = await RunProbeAsync("desktop-status.mjs", null, cancellationToken);
                var data = json.RootElement;
                var capacity = data.GetProperty("capacity");
                ConnectionText.Text = "Connected · Tunnel ready: " + data.GetProperty("tunnelReady").GetBoolean();
                VersionText.Text = "Version: " + data.GetProperty("version").GetString();
                CapacityText.Text = $"Slots: {capacity.GetProperty("occupied").GetInt32()} / {capacity.GetProperty("limit").GetInt32()} occupied";
                JobsText.Text = "Running jobs: " + data.GetProperty("runningJobs").GetInt32();
                SampleText.Text = "Last sample: " + data.GetProperty("sampledUtc").GetString();
                InventoryText.Text = data.GetProperty("inventoryComplete").GetBoolean()
                    ? "Inventory: complete" : "Inventory: partial — results may be missing";
                var selectedId = (JobList.SelectedItem as ListBoxItem)?.Tag as string;
                JobList.Items.Clear();
                ListBoxItem? selection = null;
                foreach (var job in data.GetProperty("jobs").EnumerateArray())
                {
                    var id = job.GetProperty("id").GetString() ?? "";
                    var project = job.GetProperty("project").GetString() ?? "";
                    var state = job.GetProperty("status").GetString() ?? "";
                    var kind = job.GetProperty("kind").GetString() ?? "";
                    var item = new ListBoxItem { Content = $"{state} | {kind} | {project} | {id}", Tag = id };
                    JobList.Items.Add(item);
                    if (id == selectedId) selection = item;
                }
                JobList.SelectedItem = selection;
                if (JobList.Items.Count == 0) JobList.Items.Add("No active or retained command jobs");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception)
            {
                ConnectionText.Text = "Disconnected / status unavailable";
                VersionText.Text = "Version: —";
                CapacityText.Text = "Slots: —";
                JobsText.Text = "Running jobs: —";
                SampleText.Text = "Last sample: unavailable";
                InventoryText.Text = "Inventory: unavailable";
                JobList.Items.Clear();
                DetailsText.Text = "Workbridge disconnected; previously retrieved job details cleared.";
            }
            try { await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async void DetailsButton_Click(object sender, RoutedEventArgs e)
    {
        var jobId = (JobList.SelectedItem as ListBoxItem)?.Tag as string;
        if (string.IsNullOrWhiteSpace(jobId))
        {
            DetailsText.Text = "Select an actual job record first.";
            return;
        }
        DetailsButton.IsEnabled = false;
        DetailsText.Text = "Loading job details...";
        try
        {
            using var json = await RunProbeAsync("desktop-job-detail.mjs", jobId, _stop.Token);
            var data = json.RootElement;
            // Selection can change while an asynchronous MCP request is in flight.
            if (((JobList.SelectedItem as ListBoxItem)?.Tag as string) != jobId)
            {
                DetailsText.Text = "Selection changed; choose View selected job details again.";
                return;
            }
            var state = data.GetProperty("status").GetString();
            var exit = data.GetProperty("exitCode");
            var exitLabel = exit.ValueKind == JsonValueKind.Null ? "pending" : exit.ToString();
            var truncated = data.GetProperty("outputTruncated").GetBoolean();
            DetailsText.Text = $"Job: {jobId}\nStatus: {state}\nExit code: {exitLabel}\n" +
                $"Captured output truncated: {truncated}\n\n" + data.GetProperty("log").GetString();
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (Exception)
        {
            DetailsText.Text = "Job details unavailable. The job may have expired or Workbridge may be disconnected.";
        }
        finally
        {
            DetailsButton.IsEnabled = true;
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
    }
}
