using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;

if (args.Length != 1 || !Path.IsPathFullyQualified(args[0]) || !Directory.Exists(args[0])) return 2;
var directory = Path.GetFullPath(args[0]);
try
{
    // An additional guard against manual duplicate starts outside Task Scheduler.
    using var lease = new FileStream(Path.Combine(directory, "heartbeat.lock"),
        FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    using var identity = WindowsIdentity.GetCurrent();
    var elevated = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    var instance = Guid.NewGuid().ToString("N");
    var startedUtc = DateTimeOffset.UtcNow;
    var process = Process.GetCurrentProcess();
    long sequence = 0;
    while (true)
    {
        var json = JsonSerializer.Serialize(new {
            schema = 1, marker = "WORKBRIDGE_PERSISTENT_HELPER_OK", instance,
            pid = Environment.ProcessId, sessionId = process.SessionId, startedUtc,
            sequence = ++sequence, updatedUtc = DateTimeOffset.UtcNow, elevated
        });
        var temporary = Path.Combine(directory, "heartbeat.tmp");
        File.WriteAllText(temporary, json);
        File.Move(temporary, Path.Combine(directory, "heartbeat.json"), overwrite: true);
        await Task.Delay(1000);
    }
}
catch (IOException) { return 3; }
catch (UnauthorizedAccessException) { return 4; }
