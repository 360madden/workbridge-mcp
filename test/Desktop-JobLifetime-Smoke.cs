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
            string mode = args.Length > 0 ? args[0] : "";
            if (mode == "wait-gate" && args.Length == 2)
            {
                using (EventWaitHandle gate = EventWaitHandle.OpenExisting(args[1]))
                    return gate.WaitOne(20000) ? 0 : 6;
            }
            if (mode == "longsleep")
            {
                Thread.Sleep(8000);
                return 0;
            }
            string self = Process.GetCurrentProcess().MainModule.FileName;
            if (mode == "spawn-grandchild" && args.Length == 2)
            {
                var info = new ProcessStartInfo(self, "wait-gate " + args[1])
                    { UseShellExecute = false, CreateNoWindow = true };
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
            // The descendant waits for an explicit release event, so scheduler
            // contention cannot make it exit before the host observes it.
            string gateName = "Local\\WBDesktopSmoke_" + Guid.NewGuid().ToString("N");
            using (EventWaitHandle gate = new EventWaitHandle(false, EventResetMode.ManualReset, gateName))
            {
                using (Process direct = Process.Start(new ProcessStartInfo(self, "spawn-grandchild " + gateName)
                    { UseShellExecute = false, CreateNoWindow = true }))
                {
                    if (!direct.WaitForExit(5000) || direct.ExitCode != 0) return 4;
                }
                uint during = DesktopJobLifetime.ActiveProcesses();
                gate.Set();
                var clock = Stopwatch.StartNew();
                while (DesktopJobLifetime.ActiveProcesses() != 1 && clock.ElapsedMilliseconds < 5000)
                    Thread.Sleep(20);
                uint after = DesktopJobLifetime.ActiveProcesses();
                Console.WriteLine("TREE:" + first + ":" + during + ":" + after);
                return first == 1 && during >= 2 && after == 1 ? 0 : 5;
            }
        }
        catch
        {
            Console.Error.WriteLine("SYNTHETIC_JOB_SMOKE_FAILED");
            return 99;
        }
    }
}
