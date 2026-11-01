using System.Diagnostics;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

if (args.Length != 2 || args[0] is not ("scan" or "cleanup") ||
    !Regex.IsMatch(args[1], "\\A[a-f0-9]{32}\\z", RegexOptions.CultureInvariant)) return 2;
using var identity = WindowsIdentity.GetCurrent();
if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) return 5;
const string markerText = "Workbridge WindowsHealthScan storage v1\n";
string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WorkbridgePcHealth");
string scanId = args[1], directory = Path.Combine(root, scanId);
try
{
    StoragePolicy.NoLinks(root);
    bool existed = Directory.Exists(root);
    if (!existed && args[0] == "cleanup") return 4;
    StoragePolicy.CreateDirectory(root);
    string marker = Path.Combine(root, "owner.txt");
    if (!existed) StoragePolicy.WriteNew(marker, markerText);
    StoragePolicy.AssertPath(marker, false);
    if (new FileInfo(marker).Length != Encoding.UTF8.GetByteCount(markerText) || File.ReadAllText(marker) != markerText)
        throw new IOException("Unrecognized report storage.");
    // Serialize scans and cleanup; a busy invocation exits instead of retrying.
    string lockPath = Path.Combine(root, "scan.lock");
    if (!File.Exists(lockPath)) { using var created = StoragePolicy.CreateFile(lockPath); }
    StoragePolicy.AssertPath(lockPath, false);
    using var scanLock = new FileStream(lockPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
    string latest = Path.Combine(root, "latest.json");
    if (args[0] == "cleanup")
    {
        StoragePolicy.AssertPath(directory, true);
        var names = new HashSet<string>(StringComparer.Ordinal) { "report.json", "stdout.json", "stderr.txt" };
        foreach (string entry in Directory.EnumerateFileSystemEntries(directory))
        {
            if (!names.Contains(Path.GetFileName(entry)) || Directory.Exists(entry)) throw new IOException("Unexpected scan contents; cleanup refused.");
            StoragePolicy.AssertPath(entry, false);
        }
        // Verify ALL entries before deleting any of them. No recursive deletion.
        if (File.Exists(latest))
        {
            StoragePolicy.AssertPath(latest, false);
            using var saved = JsonDocument.Parse(File.ReadAllText(latest));
            if (saved.RootElement.GetProperty("scanId").GetString() == scanId) File.Delete(latest);
        }
        foreach (string entry in Directory.EnumerateFiles(directory)) File.Delete(entry);
        Directory.Delete(directory, recursive: false);
        return 0;
    }
    if (Directory.Exists(directory) || File.Exists(directory)) throw new IOException("Scan ID already exists; no repeat scan.");
    StoragePolicy.CreateDirectory(directory);
    DateTimeOffset startedUtc = DateTimeOffset.UtcNow;
    int exitCode = -1;
    string status = "diagnostic_failed", imageHealthState = "Unknown";
    bool? restartNeeded = null;
    string output = "", errors = "";
    try
    {
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var start = new ProcessStartInfo(Path.Combine(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
            RedirectStandardError = true, WorkingDirectory = windows
        };
        foreach (string key in start.Environment.Keys.ToArray())
            if (key.StartsWith("PS", StringComparison.OrdinalIgnoreCase) || key.StartsWith("DOTNET_", StringComparison.OrdinalIgnoreCase)
                || key.StartsWith("CORECLR_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("COMPLUS_", StringComparison.OrdinalIgnoreCase))
                start.Environment.Remove(key);
        string command = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; "
            + "Import-Module -Name (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/WindowsPowerShell/v1.0/Modules/Dism/Dism.psd1'); "
            + "$r=Repair-WindowsImage -Online -ScanHealth -NoRestart; "
            + "[ordered]@{imageHealthState=[string]$r.ImageHealthState;restartNeeded=[bool]$r.RestartNeeded}|ConvertTo-Json -Compress";
        foreach (string arg in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command }) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new IOException("Windows diagnostic did not start.");
        var stdout = Drain(process.StandardOutput);
        var stderr = Drain(process.StandardError);
        // Do not terminate Windows servicing because a bridge/chat job timed out.
        await process.WaitForExitAsync();
        output = await stdout; errors = await stderr; exitCode = process.ExitCode;
        if (exitCode == 0)
        {
            using var document = JsonDocument.Parse(output);
            var result = document.RootElement;
            imageHealthState = result.GetProperty("imageHealthState").GetString() ?? "Unknown";
            restartNeeded = result.GetProperty("restartNeeded").GetBoolean();
            if (imageHealthState is not ("Healthy" or "Repairable" or "NonRepairable")) throw new InvalidDataException("Unexpected Windows image state.");
            status = "diagnostic_completed";
        }
    }
    catch (Exception e) { errors += "\n" + e.GetType().Name + ": " + e.Message; }
    var report = new { schema = 1, scanId, startedUtc, completedUtc = DateTimeOffset.UtcNow, status,
        imageHealthState, restartNeeded, exitCode, action = "DISM ScanHealth", repairRequested = false };
    string json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
    StoragePolicy.WriteNew(Path.Combine(directory, "stdout.json"), output);
    StoragePolicy.WriteNew(Path.Combine(directory, "stderr.txt"), errors);
    StoragePolicy.WriteNew(Path.Combine(directory, "report.json"), json);
    if (File.Exists(latest)) StoragePolicy.AssertPath(latest, false);
    string temporary = Path.Combine(root, scanId + ".tmp");
    StoragePolicy.WriteNew(temporary, json);
    File.Move(temporary, latest, overwrite: true);
    return status == "diagnostic_completed" ? 0 : 10;
}
catch { return 11; }

static async Task<string> Drain(StreamReader reader)
{
    var result = new StringBuilder();
    char[] buffer = new char[4096];
    int count;
    while ((count = await reader.ReadAsync(buffer)) > 0)
        if (result.Length < 65536) result.Append(buffer, 0, Math.Min(count, 65536 - result.Length));
    return result.ToString();
}
