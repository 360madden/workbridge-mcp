using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;

if (args.Length != 3 || !Path.IsPathFullyQualified(args[0]) || !Directory.Exists(args[0])
    || !Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1])
    || !int.TryParse(args[2], out int interval) || interval is < 2 or > 3600) return 2;
using var identity = WindowsIdentity.GetCurrent();
if (new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) return 5;
string data = Path.GetFullPath(args[0]), repo = Path.GetFullPath(args[1]);
try
{
    using var lease = new FileStream(Path.Combine(data, "recorder.lock"), FileMode.OpenOrCreate,
        FileAccess.ReadWrite, FileShare.None);
    using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
        { Timeout = TimeSpan.FromSeconds(3) };
    string instance = Guid.NewGuid().ToString("N");
    DateTimeOffset startedUtc = DateTimeOffset.UtcNow;
    string? previousCondition = null;
    long sequence = 0;
    while (true)
    {
        var warnings = new List<string>();
        var drives = new List<object>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
                double percent = drive.TotalSize == 0 ? 0 : 100.0 * drive.AvailableFreeSpace / drive.TotalSize;
                drives.Add(new { drive = drive.Name, freeBytes = drive.AvailableFreeSpace,
                    totalBytes = drive.TotalSize, freePercent = Math.Round(percent, 2) });
                if (percent < 5 || drive.AvailableFreeSpace < 5L * 1024 * 1024 * 1024)
                    warnings.Add($"Low disk space on {drive.Name}");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            { warnings.Add($"Disk unavailable: {drive.Name}"); }
        }
        var memory = new MemoryStatus { Length = (uint)Marshal.SizeOf<MemoryStatus>() };
        bool memoryAvailable = GlobalMemoryStatusEx(ref memory);
        if (!memoryAvailable) warnings.Add("Memory status unavailable");
        else if (memory.AvailablePhysical < 512UL * 1024 * 1024) warnings.Add("Less than 512 MiB physical memory available");
        object bridge;
        try
        {
            string url = File.ReadAllText(Path.Combine(repo, ".local", "health-url.txt")).Trim();
            if (!Regex.IsMatch(url, @"\Ahttp://127\.0\.0\.1:[0-9]{1,5}\z", RegexOptions.CultureInvariant))
                throw new InvalidDataException("Unexpected health URL");
            using var response = await http.GetAsync(url + "/health?details=true", HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            using var stream = await response.Content.ReadAsStreamAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            using var buffer = new MemoryStream();
            byte[] block = new byte[4096];
            int count;
            while ((count = await stream.ReadAsync(block, timeout.Token)) > 0)
            {
                if (buffer.Length + count > 131072) throw new InvalidDataException("Health response too large");
                buffer.Write(block, 0, count);
            }
            using var document = JsonDocument.Parse(buffer.ToArray());
            JsonElement root = document.RootElement;
            bool ready = root.TryGetProperty("ready", out var r) && r.ValueKind == JsonValueKind.True;
            string? version = ReadPath(root, "components", "mcp", "details", "initialize", "server_version").GetStringOrNull();
            int? polling = ReadPath(root, "components", "control-plane", "details", "consecutive_failures").GetIntOrNull();
            bridge = new { available = true, ready, version, consecutivePollingFailures = polling };
            if (!ready) warnings.Add("Workbridge is not ready");
            if (polling > 0) warnings.Add("Workbridge polling failures");
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or HttpRequestException
            or OperationCanceledException or JsonException or InvalidOperationException or UriFormatException)
        {
            bridge = new { available = false, ready = false, error = e.GetType().Name };
            warnings.Add("Workbridge health endpoint unavailable");
        }
        object? latestScan = null;
        string scanPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "WorkbridgePcHealth", "latest.json");
        if (File.Exists(scanPath))
        {
            try
            {
                if (new FileInfo(scanPath).Length > 65536) throw new InvalidDataException();
                using var scan = JsonDocument.Parse(File.ReadAllText(scanPath));
                var s = scan.RootElement;
                latestScan = new { scanId = ReadPath(s, "scanId").GetStringOrNull(),
                    completedUtc = ReadPath(s, "completedUtc").GetStringOrNull(),
                    status = ReadPath(s, "status").GetStringOrNull(),
                    imageHealthState = ReadPath(s, "imageHealthState").GetStringOrNull() };
                string? scanStatus = ReadPath(s, "status").GetStringOrNull();
                string? imageState = ReadPath(s, "imageHealthState").GetStringOrNull();
                if (scanStatus != "diagnostic_completed") warnings.Add("Last Windows component scan did not complete successfully");
                else if (imageState != "Healthy") warnings.Add("Windows component scan reports " + imageState);
            }
            catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or JsonException)
            { warnings.Add("Saved administrator scan report unavailable"); }
        }
        string condition = warnings.Count == 0 ? "healthy" : "warning";
        var snapshot = new { schema = 1, instance, pid = Environment.ProcessId, elevated = false,
            startedUtc, updatedUtc = DateTimeOffset.UtcNow, sequence = ++sequence, intervalSeconds = interval,
            condition, uptimeSeconds = Environment.TickCount64 / 1000,
            memory = new { available = memoryAvailable, totalBytes = memory.TotalPhysical,
                freeBytes = memory.AvailablePhysical, loadPercent = memory.Load }, drives, bridge, latestScan, warnings };
        string json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions { WriteIndented = true });
        AtomicWrite(Path.Combine(data, "status.json"), json);
        AtomicWrite(Path.Combine(data, "summary.md"), $"# PC health: {condition}\n\nUpdated UTC: {DateTimeOffset.UtcNow:o}\n\n"
            + $"Instance: {instance}; sample {sequence}; PID {Environment.ProcessId}; normal user privilege.\n\n"
            + "Read status.json for disk, memory, Workbridge, and the last Windows component scan.\n\n"
            + (warnings.Count == 0 ? "No sampled warning thresholds were crossed.\n" : string.Join("\n", warnings.Select(w => "- " + w)) + "\n")
            + $"\nA report older than {Math.Max(90, interval * 3)} seconds may be stale. This is a sampled diagnostic, not hardware or security certification.\n");
        string conditionKey = string.Join("|", warnings.Order(StringComparer.Ordinal));
        if (previousCondition != conditionKey)
        {
            string log = Path.Combine(data, "transitions.jsonl");
            if (File.Exists(log) && new FileInfo(log).Length > 1048576)
                File.Move(log, log + ".previous", overwrite: true);
            File.AppendAllText(log, JsonSerializer.Serialize(new { utc = DateTimeOffset.UtcNow, instance, condition, warnings }) + "\n");
            previousCondition = conditionKey;
        }
        await Task.Delay(TimeSpan.FromSeconds(interval));
    }
}
catch (IOException) { return 3; }
catch (UnauthorizedAccessException) { return 4; }

static void AtomicWrite(string path, string content)
{
    string temporary = path + ".tmp";
    File.WriteAllText(temporary, content);
    File.Move(temporary, path, overwrite: true);
}
static JsonElement ReadPath(JsonElement root, params string[] names)
{
    foreach (string name in names)
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(name, out root)) return default;
    return root;
}
[DllImport("kernel32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

[StructLayout(LayoutKind.Sequential)]
struct MemoryStatus
{
    public uint Length, Load;
    public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile,
        TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
}
static class JsonValues
{
    public static string? GetStringOrNull(this JsonElement value) => value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    public static int? GetIntOrNull(this JsonElement value) => value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int n) ? n : null;
}
