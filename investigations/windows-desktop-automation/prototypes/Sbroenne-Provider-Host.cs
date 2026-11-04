// Isolated Sbroenne MCP stdio sampler supervisor. NOT production Workbridge code.
// Compile with the isolated prototypes/Sbroenne-JobLifetime.cs. Private non-inherited
// kill-on-close Job Object; does not invoke any GUI API or WinCLI daemon itself.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Workbridge;

internal static class SbroenneProviderHost
{
    private const int OverallMs = 50000;
    private const int ReadyMs = 15000;
    private const int MaxLine = 4096;
    private const string NodePath = @"C:\Program Files\nodejs\node.exe";
    private const string NodeSha = "119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af";
    private const string ProtoDir = @"C:\work\workbridge-mcp\investigations\windows-desktop-automation\prototypes";
    private const string SyntheticSha = "5ba53304594b2159252145f45139b21d8eb96ce45fa72a3a771bf9760280ae02";
    private const string SnapshotSha = "c30a69346057214d4b75f35016620e671785292b442507c0e3fdbfb52572b27a";
    private static readonly Stopwatch Clock = Stopwatch.StartNew();

    private static string Q(string s)
    {
        // Windows CommandLineToArgvW-compatible quoting for one literal argument.
        string result = "\"";
        int backslashes = 0;
        foreach (char c in s)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"')
            {
                result += new string('\\', backslashes * 2 + 1) + '"';
                backslashes = 0;
                continue;
            }
            result += new string('\\', backslashes) + c;
            backslashes = 0;
        }
        return result + new string('\\', backslashes * 2) + '"';
    }

    private static int Remaining(int limit)
    {
        return Math.Max(1, limit - (int)Clock.ElapsedMilliseconds);
    }

    private static string ReadLine(Process worker, int limit)
    {
        Task<string> pending = Task.Run(() =>
        {
            var bounded = new StringBuilder();
            while (true)
            {
                int next = worker.StandardOutput.Read();
                if (next < 0) throw new InvalidOperationException("CHILD_PROTOCOL_EOF");
                if (next == '\n') return bounded.ToString();
                if (next == '\0' || (next < 32 && next != '\r'))
                    throw new InvalidOperationException("CHILD_PROTOCOL_INVALID");
                if (next != '\r') bounded.Append((char)next);
                if (bounded.Length > MaxLine)
                    throw new InvalidOperationException("CHILD_PROTOCOL_LIMIT");
            }
        });
        if (!pending.Wait(Remaining(limit)))
            throw new TimeoutException("CHILD_PROTOCOL_TIMEOUT");
        return pending.Result;
    }

    private static bool WaitForOne(int limit)
    {
        while (Clock.ElapsedMilliseconds < limit)
        {
            if (SbroenneJobLifetime.ActiveProcesses() == 1) return true;
            System.Threading.Thread.Sleep(25);
        }
        return SbroenneJobLifetime.ActiveProcesses() == 1;
    }

    private static string Sha256(string file)
    {
        using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    private static bool IsOwnedScript(string mode, string script)
    {
        string exact = Path.Combine(ProtoDir,
            mode == "synthetic" ? "sbroenne-job-synthetic.mjs" : "sbroenne-desktopprobe-sample.mjs");
        string expected = mode == "synthetic" ? SyntheticSha : SnapshotSha;
        return script.Equals(exact, StringComparison.OrdinalIgnoreCase) &&
            (File.GetAttributes(script) & FileAttributes.ReparsePoint) == 0 && Sha256(script) == expected;
    }

    private static bool SafeResult(string line)
    {
        return Regex.IsMatch(line, @"^RESULT:(success|blocked|unknown):[A-Z][A-Z0-9_]{2,63}:(none|[a-f0-9]{64})$");
    }

    private static int Main(string[] args)
    {
        // Mode, Node executable, exact script, private target manifest or "-", request ID.
        if (args.Length != 5 || (args[0] != "synthetic" && args[0] != "snapshot"))
            return 64;
        if (!Regex.IsMatch(args[4], @"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$"))
            return 64;
        string mode = args[0];
        string node = Path.GetFullPath(args[1]);
        string script = Path.GetFullPath(args[2]);
        if (!node.Equals(NodePath, StringComparison.OrdinalIgnoreCase) ||
            (File.GetAttributes(node) & FileAttributes.ReparsePoint) != 0 ||
            Sha256(node) != NodeSha || !IsOwnedScript(mode, script))
            return 64;
        if (mode == "synthetic" && args[3] != "-") return 64;
        if (mode == "snapshot" && (args[3] == "-" ||
            !Path.IsPathRooted(args[3]) || args[3].StartsWith(@"\\", StringComparison.Ordinal)))
            return 64;

        Process worker = null;
        bool ownerAttached = false;
        try
        {
            SbroenneJobLifetime.Attach();
            ownerAttached = true;
            var info = new ProcessStartInfo(node, Q(script) + " " + Q(mode) + " " + Q(args[3]) + " " + Q(args[4]))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(script)
            };
            worker = Process.Start(info);
            if (worker == null) throw new InvalidOperationException("SAMPLER_SPAWN_FAILED");
            // Consume but never forward Node stderr: future UI error text might be private.
            worker.ErrorDataReceived += (sender, eventArgs) => { };
            worker.BeginErrorReadLine();

            string first = ReadLine(worker, ReadyMs);
            string safeResult;
            int observedReadyCount = 0;
            int childPid = 0;
            if (SafeResult(first))
            {
                // Fail-closed preflight result: server never started.
                safeResult = first;
            }
            else
            {
                Match ready = Regex.Match(first, @"^READY:([1-9][0-9]{0,9})$");
                if (!ready.Success) throw new InvalidOperationException("BAD_READY_LINE");
                childPid = int.Parse(ready.Groups[1].Value);
                if (childPid == worker.Id || childPid <= 0)
                    throw new InvalidOperationException("WRONG_SERVER_PID");

                observedReadyCount = (int)SbroenneJobLifetime.ActiveProcesses();
                int[] members = SbroenneJobLifetime.ActiveProcessIds();
                Console.Out.WriteLine("HOST:READY_ACTIVE:" + observedReadyCount + ":NODE_PID:" + worker.Id + ":CHILD_PID:" + childPid + ":MEMBERS:" + string.Join(",", members));
                // One bounded synthetic-only diagnostic: names/start times, never command lines.
                if (mode == "synthetic")
                {
                    foreach (int id in members)
                    {
                        try
                        {
                            using (Process item = Process.GetProcessById(id))
                                Console.Out.WriteLine("HOST:JOB_MEMBER:" + id + ":" +
                                    Regex.Replace(item.ProcessName, @"[^A-Za-z0-9_.-]", "_") +
                                    ":" + item.StartTime.ToUniversalTime().ToString("yyyyMMddTHHmmssZ"));
                        }
                        catch { Console.Out.WriteLine("HOST:JOB_MEMBER:" + id + ":UNAVAILABLE"); }
                    }
                }
                int selfPid = Process.GetCurrentProcess().Id;
                if (!SbroenneJobLifetime.Contains(selfPid) || !SbroenneJobLifetime.Contains(worker.Id) ||
                    !SbroenneJobLifetime.Contains(childPid))
                    throw new InvalidOperationException("PRIVATE_JOB_MISSING_EXACT_MEMBERS");
                int[] expectedMembers = new int[] { selfPid, worker.Id, childPid };
                Array.Sort(expectedMembers);
                if (observedReadyCount != 3 || members.Length != 3 ||
                    members[0] != expectedMembers[0] || members[1] != expectedMembers[1] ||
                    members[2] != expectedMembers[2])
                    throw new InvalidOperationException("JOB_CHILD_COUNT_NOT_THREE");
                using (Process server = Process.GetProcessById(childPid))
                {
                    if (server.HasExited) throw new InvalidOperationException("SERVER_EXITED_AT_READY");
                }

                // This is a child-lifetime ACK only; sampler separately enforces
                // the fresh PID/HWND lease/oracle before any UIA request.
                worker.StandardInput.WriteLine("GO");
                worker.StandardInput.Flush();
                safeResult = ReadLine(worker, OverallMs);
                if (!SafeResult(safeResult))
                    throw new InvalidOperationException("BAD_RESULT_LINE");
            }

            if (!worker.WaitForExit(Remaining(OverallMs)))
                throw new TimeoutException("SAMPLER_EXIT_TIMEOUT");
            if (!WaitForOne(OverallMs))
                throw new InvalidOperationException("JOB_DESCENDANTS_NOT_SETTLED");
            // Only now may results be published: all descendants have settled in our private Job.
            Console.Out.WriteLine(safeResult);
            Console.Out.WriteLine("HOST:SETTLED:1:READY_ACTIVE:" + observedReadyCount +
                ":NODE_PID:" + worker.Id + ":SERVER_PID:" + childPid + ":DURATION_MS:" + Clock.ElapsedMilliseconds);
            return worker.ExitCode == 0 ? 0 : 2;
        }
        catch (Exception ex)
        {
            string code = ex.Message;
            if (!Regex.IsMatch(code, @"^[A-Z][A-Z_]{2,70}$")) code = "HOST_SUPERVISION_ERROR";
            Console.Out.WriteLine("HOST:UNKNOWN:" + code + ":ATTACHED:" + (ownerAttached ? "1" : "0"));
            // Do not report settled. Parent Workbridge Job and our private Job kill-on-close
            // bound unfinished descendants when this host process exits.
            return 3;
        }
        finally
        {
            if (worker != null)
            {
                try { if (!worker.HasExited) worker.Kill(); } catch { }
                worker.Dispose();
            }
        }
    }
}
