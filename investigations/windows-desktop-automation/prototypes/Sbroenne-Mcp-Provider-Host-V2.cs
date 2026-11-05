// M3-P6 ISOLATED MCP provider supervisor. Reuses v2 child-only private Job.
// Current build deliberately BLOCKS snapshot dispatch; protocol-only tools/list
// has zero UIA tool calls. No production Workbridge code or desktop lock.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

internal static class SbroenneMcpProviderHostV2
{
    // Read-only snapshot dispatch requires an explicit newly reviewed compiler define.
    // This M3-P6 build deliberately omits ENABLE_SBROENNE_UI_SNAPSHOT.
    private const string NodePath=@"C:\Program Files\nodejs\node.exe";
    private const string NodeSha="119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af";
    private const string ProtocolScript=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\prototypes\sbroenne-mcp-v2-protocol-only.mjs";
    private const string ProtocolSha="caef6ab7dc8a961371a840c8730776f4cdb00b36b864dbc86c7cbb0aacd02078";
    private const string SnapshotScript=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\prototypes\sbroenne-desktopprobe-sample.mjs";
    private const string SnapshotSha="b49a70771b45f7504c8df06e627af3cf661d35712c011f39cdcccb2f7b1c6fd4";
    private const string ServerDir=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-stdio-publish";
    private const string ServerExeSha="c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9";
    private const string ServerDllSha="99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900";
    private const string RuntimeConfigSha="6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39";

    private static string HashFile(string filename)
    {
        using(var input=File.OpenRead(filename))
        using(var sha=SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
    }
    private static bool Pinned(string filename,string expected)
    {
        return File.Exists(filename) && (File.GetAttributes(filename)&FileAttributes.ReparsePoint)==0 &&
            HashFile(filename)==expected;
    }
    private static bool ServerPinsValid()
    {
        return Pinned(Path.Combine(ServerDir,"Sbroenne.WindowsMcp.exe"),ServerExeSha) &&
            Pinned(Path.Combine(ServerDir,"Sbroenne.WindowsMcp.dll"),ServerDllSha) &&
            Pinned(Path.Combine(ServerDir,"Sbroenne.WindowsMcp.runtimeconfig.json"),RuntimeConfigSha);
    }
    private static bool KnownConhost(int pid,int session,DateTime started)
    {
        using(Process p=Process.GetProcessById(pid))
        {
            string image=Path.GetFullPath(p.MainModule.FileName);
            string windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            bool system=image.Equals(Path.Combine(windows,"System32","conhost.exe"),
                StringComparison.OrdinalIgnoreCase) ||
                image.Equals(Path.Combine(windows,"SysWOW64","conhost.exe"),
                StringComparison.OrdinalIgnoreCase);
            return system && p.SessionId==session &&
                p.StartTime.ToUniversalTime()>=started.AddSeconds(-5) &&
                p.StartTime.ToUniversalTime()<=DateTime.UtcNow.AddSeconds(2);
        }
    }
    private static bool AcceptManifestArgument(string value)
    {
        if (!Path.IsPathRooted(value) || value.StartsWith(@"\\",StringComparison.Ordinal))
            return false;
        string full=Path.GetFullPath(value);
        string prefix=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\desktopprobe-";
        return full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase) &&
            full.EndsWith(@"\evidence\target-manifest.json",StringComparison.OrdinalIgnoreCase) &&
            File.Exists(full) && (File.GetAttributes(full)&FileAttributes.ReparsePoint)==0;
    }
    private static int Main(string[] args)
    {
        if (args.Length!=3 || (args[0]!="protocol" && args[0]!="snapshot") ||
            !Regex.IsMatch(args[2],@"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$") ||
            (args[0]=="protocol" && args[1]!="-"))
        {
            Console.Out.WriteLine("HOST:BLOCKED:INVALID_ARGS");
            return 64;
        }
        string mode=args[0];
#if !ENABLE_SBROENNE_UI_SNAPSHOT
        if (mode=="snapshot")
        {
            Console.Out.WriteLine("HOST:BLOCKED:UI_SNAPSHOT_NOT_AUTHORIZED");
            return 64; // no MCP child launched, no UIA code executed
        }
#else
        if (mode=="snapshot" && !AcceptManifestArgument(args[1]))
        {
            Console.Out.WriteLine("HOST:BLOCKED:INVALID_TARGET_MANIFEST");
            return 64;
        }
#endif
        string script=mode=="protocol"?ProtocolScript:SnapshotScript;
        string expected=mode=="protocol"?ProtocolSha:SnapshotSha;
        if (!Pinned(NodePath,NodeSha) || !Pinned(script,expected) || !ServerPinsValid())
        {
            Console.Out.WriteLine("HOST:BLOCKED:PIN_MISMATCH");
            return 64;
        }

        SbroennePrivateJobV2 job=null;
        SbroenneSuspendedMcpNodeV2 runner=null;
        bool settled=false;
        string failure="MCP_HOST_UNKNOWN";
        var clock=Stopwatch.StartNew();
        try
        {
            job=SbroennePrivateJobV2.Create(); // host stays OUTSIDE child-only Job
            DateTime admission=DateTime.UtcNow;
            runner=SbroenneSuspendedMcpNodeV2.Create(NodePath,script,mode,args[1],args[2]);
            job.AssignSuspended(runner.ProcessHandle,runner.Pid);
            Console.Out.WriteLine("HOST:ASSIGNED_SUSPENDED:"+runner.Pid+":ACTIVE:1");
            runner.ResumeAfterAssignment();

            string first=runner.ReadLine(15000);
            Match ready=Regex.Match(first,@"^READY:([1-9][0-9]{0,9})$");
            if (!ready.Success) throw new InvalidOperationException("MCP_READY_MISSING");
            int serverPid=int.Parse(ready.Groups[1].Value);
            int[] members=job.Snapshot();
            if (serverPid==runner.Pid || members.Length<2 ||
                Array.IndexOf(members,runner.Pid)<0 || Array.IndexOf(members,serverPid)<0)
                throw new InvalidOperationException("MCP_JOB_MEMBERS_MISSING");
            using(Process parent=Process.GetProcessById(runner.Pid))
            using(Process server=Process.GetProcessById(serverPid))
            {
                if (parent.HasExited || server.HasExited || parent.ProcessName!="node" ||
                    !server.MainModule.FileName.Equals(Path.Combine(ServerDir,"Sbroenne.WindowsMcp.exe"),
                        StringComparison.OrdinalIgnoreCase) ||
                    server.SessionId!=parent.SessionId ||
                    server.StartTime.ToUniversalTime()<parent.StartTime.ToUniversalTime().AddSeconds(-2) ||
                    !job.Contains(parent.Handle) || !job.Contains(server.Handle))
                    throw new InvalidOperationException("MCP_SERVER_IDENTITY_MISMATCH");
                foreach(int pid in members)
                    if (pid!=runner.Pid && pid!=serverPid &&
                        !KnownConhost(pid,parent.SessionId,admission))
                        throw new InvalidOperationException("UNEXPECTED_JOB_MEMBER");
            }
            Console.Out.WriteLine("HOST:READY_MEMBERS:"+members.Length+
                ":RUNNER:"+runner.Pid+":SERVER:"+serverPid);

            // Protocol mode can only tools/list then close; snapshot mode is disabled above.
            runner.WriteGo();
            string result=runner.ReadLine(18000);
            string expectedResult=mode=="protocol"?"RESULT:success:PROTOCOL_ONLY:none":null;
            if (result!=expectedResult)
                throw new InvalidOperationException("MCP_RESULT_UNVERIFIED");
            if (!runner.WaitExit(10000) || runner.ExitCode()!=0)
                throw new InvalidOperationException("MCP_RUNNER_EXIT_INVALID");
            if (!job.WaitEmpty(12000))
                throw new InvalidOperationException("MCP_JOB_NOT_EMPTY");

            settled=true;
            Console.Out.WriteLine(result);
            Console.Out.WriteLine("HOST:SETTLED:0:RUNNER:"+runner.Pid+
                ":SERVER:"+serverPid+":DURATION_MS:"+clock.ElapsedMilliseconds);
            return 0;
        }
        catch(Exception ex)
        {
            if (Regex.IsMatch(ex.Message,@"^[A-Z][A-Z0-9_]{2,80}$")) failure=ex.Message;
            try { if (runner!=null) runner.TerminateOwned(); } catch {}
            try { if (job!=null) job.ForceTerminate(); } catch { failure="TERMINATION_UNKNOWN"; }
            bool childExited=false;
            try { childExited=runner==null || runner.WaitExit(3000); } catch {}
            try { settled=(job==null || job.WaitEmpty(3000)) && childExited; }
            catch { settled=false; }
            Console.Out.WriteLine("HOST:BLOCKED:"+failure+":JOB_EMPTY:"+(settled?"1":"0"));
            return settled?3:4; // actual OS code; never turn unknown into success
        }
        finally
        {
            if (runner!=null) runner.Dispose();
            if (job!=null) job.Dispose();
        }
    }
}
