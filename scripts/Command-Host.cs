using System;
using System.Diagnostics;
using System.Threading;
using System.Text;
using System.IO;

// Reuse the existing Windows Job Object helper. Its last handle belongs to
// this host: normal exit, cancellation, or loss of the MCP parent's stdin
// closes the handle and terminates every remaining descendant.
internal static class CommandHost
{
    private static int Main(string[] args)
    {
        FileStream configuration = null;
        try
        {
            if (args.Length != 2 && args.Length != 3) return 126;
            Workbridge.ProcessLifetime.Attach();
            if (args.Length == 3) {
                try { configuration = File.Open(args[2], FileMode.Open, FileAccess.Read, FileShare.Read); }
                catch (IOException) { Console.Error.WriteLine("Workspace configuration is busy; retry after its local configuration operation completes."); return 126; }
            }
            Console.InputEncoding = new UTF8Encoding(false);
            string request = Console.In.ReadLine();
            if (request == null) return 126;
            var owner = new Thread(() =>
            {
                try { while (Console.In.Read() >= 0) { } }
                finally { Environment.Exit(125); }
            });
            owner.IsBackground = true;
            owner.Start();
            // The only argument is a known .js file path (no trailing slash or
            // quotes); all user command/argument data travels through stdin.
            var info = new ProcessStartInfo(args[0], "\"" + args[1] + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true
            };
            using (var worker = Process.Start(info))
            {
                byte[] bytes = Encoding.UTF8.GetBytes(request + "\n");
                worker.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
                worker.StandardInput.Close();
                worker.WaitForExit();
                return worker.ExitCode;
            }
        }
        catch
        {
            Console.Error.WriteLine("Workbridge command host failed before completing its worker.");
            return 126;
        }
        finally { if (configuration != null) configuration.Dispose(); }
    }
}
