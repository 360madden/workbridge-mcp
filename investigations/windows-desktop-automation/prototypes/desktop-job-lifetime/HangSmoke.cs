using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using Workbridge;

// Entirely synthetic: no UI Automation, window creation, mouse, keyboard,
// network, VMware, or Workbridge service calls. Only an owned temp directory.
internal static class HangSmoke
{
    private const int BlockMilliseconds = 30000;

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 3) return 2;
            string role = args[0];
            string mode = args[1];
            if (mode != "hang-before-effect" && mode != "effect-then-hang") return 2;
            if (!Path.IsPathRooted(args[2]) || args[2].StartsWith(@"\\", StringComparison.Ordinal)) return 2;
            string directory = Path.GetFullPath(args[2]);
            if (!Directory.Exists(directory) || directory.IndexOf('"') >= 0) return 2;

            if (role == "worker") return Worker(mode, directory);
            if (role == "host") return Host(mode, directory);
            return 2;
        }
        catch
        {
            Console.Error.WriteLine("SYNTHETIC_HANG_SMOKE_FAILED");
            return 99;
        }
    }

    private static int Host(string mode, string directory)
    {
        DesktopJobLifetime.Attach();
        if (DesktopJobLifetime.ActiveProcesses() != 1) return 3;
        string self = Process.GetCurrentProcess().MainModule.FileName;
        var info = new ProcessStartInfo(self, "worker " + mode + " \"" + directory + "\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using (Process worker = Process.Start(info))
        {
            uint active = DesktopJobLifetime.ActiveProcesses();
            if (active != 2) return 6; // Owner plus its single blocked worker, never an inferred membership.
            Console.Out.WriteLine("HOST:" + Process.GetCurrentProcess().Id + ":CHILD:" + worker.Id +
                ":ACTIVE:" + active + ":MODE:" + mode);
            Console.Out.Flush();
            // The parent test terminates this exact spawned host once its
            // independent evidence observer has seen the desired event.
            Thread.Sleep(BlockMilliseconds);
        }
        return 4; // Unexpected unsupervised host survival, never success.
    }

    private static int Worker(string mode, string directory)
    {
        Journal(directory, mode, "dispatch_entered");
        if (mode == "effect-then-hang")
        {
            // This marker represents the fixture's one and only side effect.
            // It is independently readable even while the worker is blocked.
            byte[] data = Encoding.UTF8.GetBytes("1\n");
            using (var stream = new FileStream(Path.Combine(directory, "effect.marker"),
                FileMode.CreateNew, FileAccess.Write, FileShare.Read))
            {
                stream.Write(data, 0, data.Length);
                stream.Flush(true);
            }
            Journal(directory, mode, "effect_committed");
        }
        Thread.Sleep(BlockMilliseconds);
        return 5; // A normal return is an invalid test outcome.
    }

    private static void Journal(string directory, string mode, string stage)
    {
        string line = "{\"schemaVersion\":1,\"stage\":\"" + stage +
            "\",\"mode\":\"" + mode +
            "\",\"pid\":" + Process.GetCurrentProcess().Id +
            ",\"utc\":\"" + DateTime.UtcNow.ToString("o") + "\"}\n";
        byte[] data = Encoding.UTF8.GetBytes(line);
        using (var stream = new FileStream(Path.Combine(directory, "journal.jsonl"),
            FileMode.Append, FileAccess.Write, FileShare.Read))
        {
            stream.Write(data, 0, data.Length);
            stream.Flush(true);
        }
    }
}
