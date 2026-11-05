// M3-P7 ISOLATED SINGLE-FILE MCP protocol supervisor. Reuses the proven V2
// suspended Node/private child-only Job. NO snapshot/tool-call path exists.
// Native private extraction base is unique and owner-only, never global env.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;

internal static class SbroenneMcpProviderHostV3
{
    private const string NodePath=@"C:\Program Files\nodejs\node.exe";
    private const string NodeSha="119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af";
    private const string ProtocolScript=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\prototypes\sbroenne-mcp-v3-singlefile-protocol.mjs";
    private const string ProtocolSha="79204d1230827979eb63c7c779c413a4fbfda9e917567b5de874c4905ed1409e";
    private const string TempDir=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp";
    private const string ServerDir=TempDir+@"\sbroenne-singlefile-publish";
    private const string ServerFile="Sbroenne.WindowsMcp.exe";
#if SBROENNE_TEST_BAD_PIN
    // Compile-time synthetic negative test: refuse before creating a child.
    private const string ServerExeSha="0000000000000000000000000000000000000000000000000000000000000000";
#else
    private const string ServerExeSha="ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128";
#endif
    private const long ServerExeSize=59893792L;

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
        if (!Directory.Exists(ServerDir) ||
            (File.GetAttributes(ServerDir)&FileAttributes.ReparsePoint)!=0) return false;
        string[] entries=Directory.GetFileSystemEntries(ServerDir);
        string exe=Path.Combine(ServerDir,ServerFile);
        return entries.Length==1 &&
            Path.GetFullPath(entries[0]).Equals(exe,StringComparison.OrdinalIgnoreCase) &&
            new FileInfo(exe).Length==ServerExeSize && Pinned(exe,ServerExeSha);
    }
    private static bool IsRealDirectory(string directory)
    {
        return Directory.Exists(directory) &&
            (File.GetAttributes(directory)&FileAttributes.ReparsePoint)==0;
    }
    private static SecurityIdentifier CurrentOwner()
    {
        SecurityIdentifier sid=WindowsIdentity.GetCurrent().User;
        if (sid==null) throw new InvalidOperationException("OWNER_SID_MISSING");
        return sid;
    }
    private static string PrivateExtractionRoot(string sampleId)
    {
        // Canonical, literal investigation path; no attacker-provided directory.
        foreach (string parent in new [] { @"C:\work", @"C:\work\workbridge-mcp",
            @"C:\work\workbridge-mcp\investigations",
            @"C:\work\workbridge-mcp\investigations\windows-desktop-automation", TempDir })
        {
            if (!IsRealDirectory(parent)) throw new InvalidOperationException("EXTRACTION_PARENT_UNTRUSTED");
        }
        string directory=Path.Combine(TempDir,"sbroenne-v3-extract-"+sampleId);
        if (Directory.Exists(directory) || File.Exists(directory))
            throw new InvalidOperationException("EXTRACTION_ALREADY_EXISTS");
        SecurityIdentifier owner=CurrentOwner();
        var acl=new DirectorySecurity();
        acl.SetAccessRuleProtection(true,false); // no inherited broad DACL
        acl.SetOwner(owner);
        acl.AddAccessRule(new FileSystemAccessRule(owner,FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,
            PropagationFlags.None,AccessControlType.Allow));
        Directory.CreateDirectory(directory,acl); // fail closed if ACL creation fails
        if (!PrivateExtractIsOwnerOnly(directory,owner) ||
            Directory.GetFileSystemEntries(directory).Length!=0)
            throw new InvalidOperationException("EXTRACTION_OWNER_ACL_INVALID");
        return directory;
    }
    private static bool PrivateExtractIsOwnerOnly(string directory,SecurityIdentifier owner)
    {
        if (!IsRealDirectory(directory)) return false;
        DirectorySecurity security=Directory.GetAccessControl(directory,
            AccessControlSections.Owner|AccessControlSections.Access);
        if (!owner.Equals(security.GetOwner(typeof(SecurityIdentifier)))) return false;
        // The root itself has a protected DACL containing only our account.
        if (!security.AreAccessRulesProtected) return false;
        AuthorizationRuleCollection rules=security.GetAccessRules(true,false,
            typeof(SecurityIdentifier));
        if (rules.Count!=1) return false;
        var rule=rules[0] as FileSystemAccessRule;
        return rule!=null && rule.AccessControlType==AccessControlType.Allow &&
            owner.Equals(rule.IdentityReference) &&
            (rule.FileSystemRights&FileSystemRights.FullControl)==FileSystemRights.FullControl;
    }
    private static int ValidateExtractContents(string directory)
    {
        if (!PrivateExtractIsOwnerOnly(directory,CurrentOwner()))
            throw new InvalidOperationException("EXTRACTION_OWNER_CHANGED");
        // .NET may leave private self-extracted native DLLs for reuse. Preserve
        // these ignored research bytes for audit; Job0 is PROCESS settlement,
        // never a claim that extraction files were deleted.
        int items=0;
        var pending=new System.Collections.Generic.Stack<string>();
        pending.Push(directory);
        while(pending.Count>0)
        {
            string dir=pending.Pop();
            foreach(string entry in Directory.GetFileSystemEntries(dir))
            {
                if (++items>512 || (File.GetAttributes(entry)&FileAttributes.ReparsePoint)!=0)
                    throw new InvalidOperationException("EXTRACTION_CONTENTS_UNTRUSTED");
                if (Directory.Exists(entry)) pending.Push(entry);
                else if (!File.Exists(entry))
                    throw new InvalidOperationException("EXTRACTION_CONTENTS_UNKNOWN");
            }
        }
        return items;
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
    private static int Main(string[] args)
    {
        if (args.Length!=3 || args[0]!="protocol" || args[1]!="-" ||
            !Regex.IsMatch(args[2],@"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$"))
        {
            Console.Out.WriteLine("HOST:BLOCKED:INVALID_ARGS");
            return 64;
        }
        if (!Pinned(NodePath,NodeSha) || !Pinned(ProtocolScript,ProtocolSha) || !ServerPinsValid())
        {
            Console.Out.WriteLine("HOST:BLOCKED:PIN_MISMATCH");
            return 64;
        }

        SbroennePrivateJobV2 job=null;
        SbroenneSuspendedMcpNodeV2 runner=null;
        bool settled=false;
        string failure="MCP_HOST_UNKNOWN";
        string extractRoot=null;
        var clock=Stopwatch.StartNew();
        try
        {
            extractRoot=PrivateExtractionRoot(args[2]);
            Console.Out.WriteLine("HOST:PRIVATE_EXTRACT_ROOT:1");
            job=SbroennePrivateJobV2.Create(); // host stays OUTSIDE child-only Job
            DateTime admission=DateTime.UtcNow;
            runner=SbroenneSuspendedMcpNodeV2.Create(NodePath,ProtocolScript,"protocol","-",args[2]);
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

            // Protocol-only script can tools/list then close; no tools/call path.
            runner.WriteGo();
            string result=runner.ReadLine(18000);
            if (result!="RESULT:success:PROTOCOL_ONLY:none")
                throw new InvalidOperationException("MCP_RESULT_UNVERIFIED");
            if (!runner.WaitExit(10000) || runner.ExitCode()!=0)
                throw new InvalidOperationException("MCP_RUNNER_EXIT_INVALID");
            if (!job.WaitEmpty(12000))
                throw new InvalidOperationException("MCP_JOB_NOT_EMPTY");

            int extractedItems=ValidateExtractContents(extractRoot);
            settled=true;
            Console.Out.WriteLine(result);
            Console.Out.WriteLine("HOST:EXTRACT_ITEMS:"+extractedItems+":RETAINED_FOR_AUDIT:1");
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

