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
    private bool _refreshingJobs;
    private long _selectionRevision;
    private long _statusRevision;
    private long _assignmentInputRevision;
    private string? _detailsForJobId;

    public MainWindow()
    {
        InitializeComponent();
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Open dashboard", null, (_, _) => DispatchTrayAction(RestoreWindow));
        menu.Items.Add("Exit Control Center", null, (_, _) => DispatchTrayAction(ExitGui));
        _trayIcon = new Forms.NotifyIcon
        {
            Text = "Workbridge Control Center",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => DispatchTrayAction(RestoreWindow);
        _ = PollStatusAsync(_stop.Token);
    }

    private void DispatchTrayAction(Action action)
    {
        if (_exiting || Dispatcher.HasShutdownStarted || Dispatcher.HasShutdownFinished) return;
        try
        {
            if (Dispatcher.CheckAccess())
            {
                action();
            }
            else
            {
                Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (!_exiting && !Dispatcher.HasShutdownStarted) action();
                }));
            }
        }
        catch (InvalidOperationException)
        {
            // A queued tray event can race GUI shutdown; it must not resurrect
            // or invoke disposed WPF controls.
        }
    }

    private static string RepoRoot()
    {
        // A distributed executable need not be inside the Workbridge checkout.
        // An explicit local config takes priority; ancestor discovery remains useful
        // for development checkouts and isolated fixtures without a config file.
        var config = Path.Combine(AppContext.BaseDirectory, "workbridge-control-center.json");
        if (File.Exists(config))
        {
            using var json = JsonDocument.Parse(File.ReadAllText(config));
            var configuredRoot = json.RootElement.GetProperty("repositoryRoot").GetString();
            if (string.IsNullOrWhiteSpace(configuredRoot) || !Path.IsPathFullyQualified(configuredRoot))
                throw new InvalidDataException("Workbridge installation path must be absolute.");
            var root = Path.GetFullPath(configuredRoot);
            if (!File.Exists(Path.Combine(root, "scripts", "desktop-monitor.mjs")))
                throw new DirectoryNotFoundException("Configured Workbridge installation does not contain its monitor script.");
            return root;
        }
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "scripts", "desktop-status.mjs")))
                return directory.FullName;
            directory = directory.Parent;
        }
        throw new FileNotFoundException("Workbridge probe scripts were not found in an ancestor directory.");
    }

    private static async Task<JsonDocument> RunProbeAsync(string scriptName, string? argument,
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
        if (argument is not null) process.StartInfo.ArgumentList.Add(argument);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        process.Start();
        string? output;
        try
        {
            // A probe must return exactly one bounded JSON message. Neither a
            // malformed script nor a broken MCP response may grow GUI memory.
            var reader = new BoundedLineReader(process.StandardOutput, 64_000);
            output = await reader.ReadLineAsync(timeout.Token);
            if (output is null) throw new InvalidDataException("Workbridge probe returned no message.");
            if (await reader.ReadLineAsync(timeout.Token) is not null)
                throw new InvalidDataException("Workbridge probe returned multiple messages.");
            await process.WaitForExitAsync(timeout.Token);
        }
        catch
        {
            // Kill on any failure, not only timeout: over-limit and invalid
            // output must not strand an on-demand Node process.
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

    // A single long-lived Node client streams bounded read-only diagnostics.
    // If it crashes, the GUI shows offline and starts a new client after a delay.
    private async Task PollStatusAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            Process? monitor = null;
            try
            {
                var root = RepoRoot();
                var script = Path.Combine(root, "scripts", "desktop-monitor.mjs");
                if (!File.Exists(script)) throw new FileNotFoundException("Monitor script unavailable.");
                monitor = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "node.exe",
                        WorkingDirectory = root,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardInput = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = false
                    }
                };
                monitor.StartInfo.Environment["WORKBRIDGE_DESKTOP_PARENT_PIPE"] = "1";
                monitor.StartInfo.ArgumentList.Add(script);
                monitor.Start();
                // Enforce the message limit while reading rather than after a
                // possibly unbounded ReadLineAsync allocation.
                var boundedOutput = new BoundedLineReader(monitor.StandardOutput, 64_000);
                while (!cancellationToken.IsCancellationRequested)
                {
                    // A live child can stop producing output without exiting.
                    // Require a heartbeat within 25 seconds; otherwise the outer
                    // recovery loop marks the dashboard offline and replaces only
                    // its own monitor process.
                    using var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    heartbeat.CancelAfter(TimeSpan.FromSeconds(25));
                    var line = await boundedOutput.ReadLineAsync(heartbeat.Token);
                    if (line is null) throw new IOException("Monitor exited.");
                    using var json = JsonDocument.Parse(line);
                    if (_exiting || cancellationToken.IsCancellationRequested) break;
                    if (json.RootElement.TryGetProperty("ok", out var ok) && ok.GetBoolean())
                        ApplyStatus(json.RootElement);
                    else
                        ShowOffline();
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception)
            {
                if (!_exiting && !cancellationToken.IsCancellationRequested) ShowOffline();
            }
            finally
            {
                if (monitor is not null)
                {
                    try
                    {
                        if (!monitor.HasExited) monitor.Kill(entireProcessTree: true);
                    }
                    catch (InvalidOperationException) { }
                    catch (Win32Exception) { }
                    monitor.Dispose();
                }
            }
            try { await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void ApplyStatus(JsonElement data)
    {
        var capacity = data.GetProperty("capacity");
        var tunnelReady = data.GetProperty("tunnelReady").GetBoolean();
        var controlPlane = data.GetProperty("controlPlane").GetString() ?? "unknown";
        ConnectionText.Text = tunnelReady && string.Equals(controlPlane, "ok", StringComparison.OrdinalIgnoreCase)
            ? "Connected · Tunnel ready: True"
            : "Engine reachable · Tunnel/control plane degraded";
        VersionText.Text = "Version: " + data.GetProperty("version").GetString();
        ControlPlaneText.Text = "Control plane: " + controlPlane;
        CapacityText.Text = $"Slots: {capacity.GetProperty("occupied").GetInt32()} / {capacity.GetProperty("limit").GetInt32()} occupied";
        JobsText.Text = "Running jobs: " + data.GetProperty("runningJobs").GetInt32();
        var retained = capacity.GetProperty("retainedResults");
        RetainedText.Text = "Retained results: " + (retained.ValueKind == JsonValueKind.Number ? retained.GetInt32().ToString() : "unavailable");
        SampleText.Text = "Last sample: " + data.GetProperty("sampledUtc").GetString();
        InventoryText.Text = data.GetProperty("inventoryComplete").GetBoolean()
            ? "Inventory: complete" : "Inventory: partial — results may be missing";
        var selectedId = (JobList.SelectedItem as ListBoxItem)?.Tag as string;
        _refreshingJobs = true;
        try
        {
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
        finally { _refreshingJobs = false; }
        ClearDetailsIfSelectionChanged();
    }

    private void ClearDetailsIfSelectionChanged()
    {
        var selected = (JobList.SelectedItem as ListBoxItem)?.Tag as string;
        if (_detailsForJobId is null || string.Equals(selected, _detailsForJobId, StringComparison.Ordinal)) return;
        _detailsForJobId = null;
        DetailsText.Text = "Selection changed; choose View selected job details again.";
    }

    private void JobList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_refreshingJobs) return;
        _selectionRevision++;
        ClearDetailsIfSelectionChanged();
    }

    private void ShowOffline()
    {
        _statusRevision++; // Invalidate lookups started before a disconnect.
        ConnectionText.Text = "Disconnected / status unavailable";
        VersionText.Text = "Version: —";
        ControlPlaneText.Text = "Control plane: —";
        CapacityText.Text = "Slots: —";
        JobsText.Text = "Running jobs: —";
        RetainedText.Text = "Retained results: —";
        SampleText.Text = "Last sample: unavailable";
        InventoryText.Text = "Inventory: unavailable";
        _selectionRevision++; // Invalidate in-flight details even if the same ID returns later.
        _detailsForJobId = null;
        JobList.Items.Clear();
        DetailsText.Text = "Workbridge disconnected; previously retrieved job details cleared.";
        AssignmentsSummary.Text = "Assignments unavailable while Workbridge is offline.";
        AssignmentsList.Items.Clear();
    }

    private async void DetailsButton_Click(object sender, RoutedEventArgs e)
    {
        var jobId = (JobList.SelectedItem as ListBoxItem)?.Tag as string;
        if (string.IsNullOrWhiteSpace(jobId))
        {
            DetailsText.Text = "Select an actual job record first.";
            return;
        }
        var selectionRevision = _selectionRevision;
        _detailsForJobId = jobId;
        DetailsButton.IsEnabled = false;
        DetailsText.Text = "Loading job details...";
        try
        {
            using var json = await RunProbeAsync("desktop-job-detail.mjs", jobId, _stop.Token);
            if (_exiting || _stop.IsCancellationRequested) return;
            var data = json.RootElement;
            // Selection can change while an asynchronous MCP request is in flight.
            if (_selectionRevision != selectionRevision ||
                ((JobList.SelectedItem as ListBoxItem)?.Tag as string) != jobId)
            {
                // A -> B -> A must not accept A's earlier, now-stale response.
                // The selection handler already cleared the old output.
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
            if (!_exiting && !_stop.IsCancellationRequested && _selectionRevision == selectionRevision)
                DetailsText.Text = "Job details unavailable. The job may have expired or Workbridge may be disconnected.";
        }
        finally
        {
            if (!_exiting && !_stop.IsCancellationRequested) DetailsButton.IsEnabled = true;
        }
    }

    private void AssignmentsProjectText_TextChanged(object sender, TextChangedEventArgs e)
    {
        _assignmentInputRevision++;
        // XAML initialization may fire this event before the other fields exist.
        if (AssignmentsSummary is null || AssignmentsList is null) return;
        AssignmentsList.Items.Clear();
        AssignmentsSummary.Text = "Repository changed; choose Load assignments for the current repository.";
    }

    private async void AssignmentsButton_Click(object sender, RoutedEventArgs e)
    {
        var project = AssignmentsProjectText.Text.Trim();
        if (string.IsNullOrWhiteSpace(project))
        {
            AssignmentsSummary.Text = "Enter a repository path under an authorized Workbridge root.";
            return;
        }
        var statusRevision = _statusRevision;
        var inputRevision = _assignmentInputRevision;
        AssignmentsButton.IsEnabled = false;
        AssignmentsSummary.Text = "Loading recorded assignments...";
        AssignmentsList.Items.Clear();
        try
        {
            using var json = await RunProbeAsync("desktop-assignments.mjs", project, _stop.Token);
            if (_exiting || _stop.IsCancellationRequested || _statusRevision != statusRevision ||
                _assignmentInputRevision != inputRevision) return;
            if (!string.Equals(AssignmentsProjectText.Text.Trim(), project, StringComparison.Ordinal))
            {
                AssignmentsSummary.Text = "Repository selection changed. Load assignments again.";
                return;
            }
            var data = json.RootElement;
            var capacity = data.GetProperty("maxWorkers");
            var running = data.GetProperty("running");
            var recorded = data.GetProperty("recorded").GetInt32();
            var capacityLabel = capacity.ValueKind == JsonValueKind.Number ? capacity.GetInt32().ToString() : "?";
            var runningLabel = running.ValueKind == JsonValueKind.Number ? running.GetInt32().ToString() : "?";
            AssignmentsSummary.Text = $"Project: {project} | Recorded: {recorded} | Running assignment states: {runningLabel} | Capacity: {capacityLabel}. These are coordination records, not AI sessions.";
            foreach (var task in data.GetProperty("assignments").EnumerateArray())
            {
                var taskId = task.GetProperty("taskId").GetString();
                var worker = task.GetProperty("workerId").GetString();
                var state = task.GetProperty("state").GetString();
                var jobId = task.GetProperty("jobId");
                var jobLabel = jobId.ValueKind == JsonValueKind.Null ? "no job" : jobId.GetString();
                AssignmentsList.Items.Add($"{state} | {worker} | {taskId} | {jobLabel}");
            }
            if (AssignmentsList.Items.Count == 0)
                AssignmentsList.Items.Add("No coordination assignments recorded for this repository.");
            if (data.GetProperty("truncated").GetBoolean())
                AssignmentsSummary.Text += " Display limited to 36 records.";
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (Exception)
        {
            if (!_exiting && !_stop.IsCancellationRequested && _statusRevision == statusRevision &&
                _assignmentInputRevision == inputRevision)
            {
                AssignmentsList.Items.Clear();
                AssignmentsSummary.Text = "Assignment lookup unavailable. Verify the repository path and Workbridge connection.";
            }
        }
        finally
        {
            if (!_exiting && !_stop.IsCancellationRequested) AssignmentsButton.IsEnabled = true;
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
