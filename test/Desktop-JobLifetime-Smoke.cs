using System;
using System.Diagnostics;
using System.Threading;
using Workbridge;

// Synthetic only: this executable never opens a desktop, window, VM or network connection.
internal static class DesktopJobLifetimeSmoke
{
    private static int Main(string[] args)
    {
        try
        {
            string mode = args.Length == 1 ? args[0] : "";
            if (mode == "sleep")
            {
                Thread.Sleep(1750);
                return 0;
            }
            if (mode == "longsleep")
            {
                Thread.Sleep(8000);
                return 0;
            }
            string self = Process.GetCurrentProcess().MainModule.FileName;
            if (mode == "spawn-grandchild")
            {
                var info = new ProcessStartInfo(self, "sleep") { UseShellExecute = false, CreateNoWindow = true };
                using (Process child = Process.Start(info)) { }
                return 0;
            }
            DesktopJobLifetime.Attach();
            uint first = DesktopJobLifetime.ActiveProcesses();
            if (mode == "close-with-child")
            {
                using (Process child = Process.Start(new ProcessStartInfo(self, "longsleep")
                    { UseShellExecute = false, CreateNoWindow = true }))
                {
                    Console.WriteLine("CHILD:" + child.Id);
                    Console.Out.Flush();
                }
                // The final Job handle closes when this host exits, killing its child.
                return 0;
            }
            if (mode == "idle")
            {
                Console.WriteLine("IDLE:" + first);
                return first == 1 ? 0 : 2;
            }
            if (mode != "tree") return 3;
            using (Process direct = Process.Start(new ProcessStartInfo(self, "spawn-grandchild")
                { UseShellExecute = false, CreateNoWindow = true }))
            {
                if (!direct.WaitForExit(5000) || direct.ExitCode != 0) return 4;
            }
            uint during = DesktopJobLifetime.ActiveProcesses();
            var clock = Stopwatch.StartNew();
            while (DesktopJobLifetime.ActiveProcesses() != 1 && clock.ElapsedMilliseconds < 5000)
                Thread.Sleep(20);
            uint after = DesktopJobLifetime.ActiveProcesses();
            Console.WriteLine("TREE:" + first + ":" + during + ":" + after);
            return first == 1 && during >= 2 && after == 1 ? 0 : 5;
        }
        catch
        {
            Console.Error.WriteLine("SYNTHETIC_JOB_SMOKE_FAILED");
            return 99;
        }
    }
}
