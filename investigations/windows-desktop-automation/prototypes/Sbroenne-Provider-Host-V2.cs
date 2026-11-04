// M3-P5 external-owner SYNTHETIC-ONLY containment prototype; no MCP/GUI/UIA/VM/input.
// CREATE_SUSPENDED -> assign direct Node to private Job -> verify -> ResumeThread.
// Do not reuse for production/desktop probes without a separate reviewed gate.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

internal sealed class SbroenneSuspendedNodeV2 : IDisposable
{
    private const uint CREATE_SUSPENDED=0x4, CREATE_NO_WINDOW=0x08000000;
    private const uint EXTENDED_STARTUPINFO_PRESENT=0x00080000, STARTF_USESTDHANDLES=0x100;
    private const uint HANDLE_FLAG_INHERIT=1;
    private const uint WAIT_OBJECT_0=0, WAIT_TIMEOUT=258;
    private readonly SafeFileHandle processHandle, threadHandle;
    private readonly StreamReader output;
    private readonly StreamWriter input;
    private bool resumed;

    public int Pid { get; private set; }
    public IntPtr ProcessHandle { get { return processHandle.DangerousGetHandle(); } }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint cb;
        public string lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public uint dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr lpAttributeList;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write,
        ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count,
        int flags, ref IntPtr bytes);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute,
        IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,EntryPoint="CreateProcessW",SetLastError=true)]
    private static extern bool CreateProcessW(string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
        IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInformation process);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool GetExitCodeProcess(IntPtr handle, out uint exitCode);

    private SbroenneSuspendedNodeV2(int pid, SafeFileHandle process, SafeFileHandle thread,
        StreamReader reader, StreamWriter writer)
    {
        Pid=pid; processHandle=process; threadHandle=thread; output=reader; input=writer;
    }

    private static string Q(string s)
    {
        var sb = new StringBuilder("\"");
        int slash=0;
        foreach(char c in s)
        {
            if (c=='\\') { slash++; continue; }
            if (c=='"') { sb.Append('\\',slash*2+1); sb.Append('"'); slash=0; continue; }
            sb.Append('\\',slash); slash=0; sb.Append(c);
        }
        sb.Append('\\',slash*2); sb.Append('"');
        return sb.ToString();
    }

    public static SbroenneSuspendedNodeV2 Create(string node, string script, string requestId)
    {
        SafeFileHandle stdinRead=null, stdinWrite=null, stdoutRead=null, stdoutWrite=null;
        IntPtr attributeList=IntPtr.Zero, attributeValues=IntPtr.Zero;
        bool attributesInitialized=false;
        ProcessInformation info=new ProcessInformation();
        try
        {
            SecurityAttributes sa=new SecurityAttributes();
            sa.nLength=Marshal.SizeOf(typeof(SecurityAttributes));
            sa.bInheritHandle=1;
            if (!CreatePipe(out stdinRead,out stdinWrite,ref sa,0) ||
                !CreatePipe(out stdoutRead,out stdoutWrite,ref sa,0))
                throw new InvalidOperationException("PIPE_CREATE_FAILED");
            if (!SetHandleInformation(stdinWrite.DangerousGetHandle(),HANDLE_FLAG_INHERIT,0) ||
                !SetHandleInformation(stdoutRead.DangerousGetHandle(),HANDLE_FLAG_INHERIT,0))
                throw new InvalidOperationException("PIPE_PARENT_HANDLE_INHERITABLE");

            IntPtr bytes=IntPtr.Zero;
            bool probe=InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref bytes);
            int sizingError=Marshal.GetLastWin32Error();
            // Win32 supplies the exact required size; no invented minimum of 64.
            if (probe || sizingError!=122 || bytes.ToInt64()<16 || bytes.ToInt64()>8192)
                throw new InvalidOperationException("ATTRIBUTE_SIZE_INVALID");
            attributeList=Marshal.AllocHGlobal(bytes);
            if (!InitializeProcThreadAttributeList(attributeList,1,0,ref bytes))
                throw new InvalidOperationException("ATTRIBUTE_INIT_FAILED");
            attributesInitialized=true;
            attributeValues=Marshal.AllocHGlobal(IntPtr.Size*2);
            Marshal.WriteIntPtr(attributeValues,0,stdinRead.DangerousGetHandle());
            Marshal.WriteIntPtr(attributeValues,IntPtr.Size,stdoutWrite.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x00020002),
                attributeValues,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero))
                throw new InvalidOperationException("ATTRIBUTE_HANDLES_FAILED");

            StartupInfoEx startup=new StartupInfoEx();
            startup.StartupInfo.cb=(uint)Marshal.SizeOf(typeof(StartupInfoEx));
            startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput=stdinRead.DangerousGetHandle();
            startup.StartupInfo.hStdOutput=stdoutWrite.DangerousGetHandle();
            startup.StartupInfo.hStdError=stdoutWrite.DangerousGetHandle(); // no stderr forward
            startup.lpAttributeList=attributeList;
            StringBuilder command=new StringBuilder(Q(node)+" "+Q(script)+
                " synthetic - "+Q(requestId),2048);
            if (!CreateProcessW(node,command,IntPtr.Zero,IntPtr.Zero,true,
                CREATE_SUSPENDED|CREATE_NO_WINDOW|EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero,Path.GetDirectoryName(script),ref startup,out info))
                throw new InvalidOperationException("SUSPENDED_CREATE_FAILED_" + Marshal.GetLastWin32Error());
            if (info.dwProcessId <= 0 || info.hThread==IntPtr.Zero || info.hProcess==IntPtr.Zero)
                throw new InvalidOperationException("SUSPENDED_PROCESS_INVALID");

            // Drop child-side handles immediately; only explicitly listed two inherited.
            stdinRead.Dispose(); stdinRead=null;
            stdoutWrite.Dispose(); stdoutWrite=null;
            var reader=new StreamReader(new FileStream(stdoutRead,FileAccess.Read,4096,false),Encoding.UTF8);
            var writer=new StreamWriter(new FileStream(stdinWrite,FileAccess.Write,4096,false),new UTF8Encoding(false));
            writer.AutoFlush=true;
            stdoutRead=null; stdinWrite=null; // now owned by StreamReader/Writer
            var child=new SbroenneSuspendedNodeV2(info.dwProcessId,
                new SafeFileHandle(info.hProcess,true),new SafeFileHandle(info.hThread,true),reader,writer);
            info.hProcess=IntPtr.Zero; info.hThread=IntPtr.Zero; // transferred
            return child;
        }
        finally
        {
            if (attributesInitialized) DeleteProcThreadAttributeList(attributeList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (attributeValues != IntPtr.Zero) Marshal.FreeHGlobal(attributeValues);
            if (stdinRead != null) stdinRead.Dispose();
            if (stdinWrite != null) stdinWrite.Dispose();
            if (stdoutRead != null) stdoutRead.Dispose();
            if (stdoutWrite != null) stdoutWrite.Dispose();
            // Never resume an unassigned child during failed CreateProcess setup.
            // On any failed Create/transfer, never allow an unassigned child to run:
            if (info.hProcess != IntPtr.Zero) {
                TerminateProcess(info.hProcess,3);
                WaitForSingleObject(info.hProcess,3000);
                new SafeFileHandle(info.hProcess,true).Dispose();
            }
            if (info.hThread != IntPtr.Zero) new SafeFileHandle(info.hThread,true).Dispose();
        }
    }

    public void ResumeAfterAssignment()
    {
        if (resumed) throw new InvalidOperationException("DUPLICATE_RESUME");
        uint previous=ResumeThread(threadHandle.DangerousGetHandle());
        if (previous != 1) throw new InvalidOperationException("BAD_SUSPEND_COUNT");
        resumed=true;
    }
    public void WriteGo() { input.WriteLine("GO"); input.Flush(); }
    public string ReadLine(int millis)
    {
        Task<string> read=Task.Run(() => {
            var sb=new StringBuilder();
            for (;;)
            {
                int c=output.Read();
                if (c<0) throw new InvalidOperationException("SYNTHETIC_PROTOCOL_EOF");
                if (c=='\n') return sb.ToString();
                if (c=='\0' || (c<32 && c!='\r')) throw new InvalidOperationException("SYNTHETIC_PROTOCOL_INVALID");
                if (c!='\r') sb.Append((char)c);
                if (sb.Length>4096) throw new InvalidOperationException("SYNTHETIC_PROTOCOL_TOO_LONG");
            }
        });
        if (!read.Wait(millis)) throw new InvalidOperationException("SYNTHETIC_PROTOCOL_TIMEOUT");
        return read.Result;
    }
    public bool WaitExit(int millis)
    {
        return WaitForSingleObject(processHandle.DangerousGetHandle(),(uint)millis)==WAIT_OBJECT_0;
    }
    public uint ExitCode()
    {
        uint value;
        if (!GetExitCodeProcess(processHandle.DangerousGetHandle(),out value))
            throw new InvalidOperationException("NODE_EXIT_CODE_UNKNOWN");
        return value;
    }
    public void TerminateOwned()
    {
        if (processHandle != null && !processHandle.IsClosed)
            TerminateProcess(processHandle.DangerousGetHandle(),3);
    }
    public void Dispose()
    {
        try { input.Dispose(); } catch {}
        try { output.Dispose(); } catch {}
        if (threadHandle!=null) threadHandle.Dispose();
        if (processHandle!=null) processHandle.Dispose();
    }
}

internal static class SbroenneProviderHostV2
{
    private const string NodePath=@"C:\Program Files\nodejs\node.exe";
    private const string NodeSha="119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af";
    private const string Script=@"C:\work\workbridge-mcp\investigations\windows-desktop-automation\prototypes\sbroenne-job-v2-synthetic.mjs";
    private const string ScriptSha="2926455f353d65f9cff54112e71cebfb9c696676a371c56f4cbdae200c79194e";
    private static string HashFile(string filename)
    {
        using(var stream=File.OpenRead(filename))
        using(var sha=SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
    }
    private static bool IsPinned(string file, string expected)
    {
        return File.Exists(file) && (File.GetAttributes(file)&FileAttributes.ReparsePoint)==0 &&
            HashFile(file)==expected;
    }
    private static bool ExtraIsKnownConhost(int pid, int sessionId, DateTime admissionTime)
    {
        using(Process member=Process.GetProcessById(pid))
        {
            string filename=Path.GetFullPath(member.MainModule.FileName);
            string windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            bool expected=filename.Equals(Path.Combine(windows,"System32","conhost.exe"),
                StringComparison.OrdinalIgnoreCase) ||
                filename.Equals(Path.Combine(windows,"SysWOW64","conhost.exe"),
                StringComparison.OrdinalIgnoreCase);
            return expected && member.SessionId==sessionId &&
                member.StartTime.ToUniversalTime()>=admissionTime.AddSeconds(-5) &&
                member.StartTime.ToUniversalTime()<=DateTime.UtcNow.AddSeconds(2);
        }
    }
    private static int Main(string[] args)
    {
        if (args.Length!=3 || args[0]!="synthetic" ||
            (args[1]!="clean" && args[1]!="forced-failure") ||
            !Regex.IsMatch(args[2],@"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$"))
        {
            Console.Out.WriteLine("HOST:BLOCKED:INVALID_ARGS");
            return 64;
        }
        if (!IsPinned(NodePath,NodeSha) || !IsPinned(Script,ScriptSha))
        {
            Console.Out.WriteLine("HOST:BLOCKED:SOURCE_PIN_MISMATCH");
            return 64;
        }

        SbroennePrivateJobV2 job=null;
        SbroenneSuspendedNodeV2 node=null;
        string failure="UNKNOWN_FAILURE";
        bool settled=false;
        var watch=Stopwatch.StartNew();
        try
        {
            job=SbroennePrivateJobV2.Create();
            DateTime admission=DateTime.UtcNow;
            node=SbroenneSuspendedNodeV2.Create(NodePath,Script,args[2]);
            job.AssignSuspended(node.ProcessHandle,node.Pid);
            Console.Out.WriteLine("HOST:ASSIGNED_SUSPENDED:" + node.Pid + ":ACTIVE:1");
            node.ResumeAfterAssignment();

            string line=node.ReadLine(12000);
            Match ready=Regex.Match(line,@"^READY:([1-9][0-9]{0,9})$");
            if (!ready.Success) throw new InvalidOperationException("NO_SYNTHETIC_READY");
            int childPid=int.Parse(ready.Groups[1].Value);
            int[] members=job.Snapshot();
            if (childPid==node.Pid || members.Length<2 ||
                Array.IndexOf(members,node.Pid)<0 || Array.IndexOf(members,childPid)<0)
                throw new InvalidOperationException("EXPECTED_JOB_PIDS_MISSING");
            using(Process parent=Process.GetProcessById(node.Pid))
            using(Process child=Process.GetProcessById(childPid))
            {
                if (parent.HasExited || child.HasExited || parent.ProcessName!="node" ||
                    child.ProcessName!="node" || child.SessionId!=parent.SessionId ||
                    child.StartTime.ToUniversalTime()<parent.StartTime.ToUniversalTime().AddSeconds(-2) ||
                    !job.Contains(parent.Handle) || !job.Contains(child.Handle))
                    throw new InvalidOperationException("SYNTHETIC_CHILD_IDENTITY_MISMATCH");
                foreach(int pid in members)
                    if (pid!=node.Pid && pid!=childPid &&
                        !ExtraIsKnownConhost(pid,parent.SessionId,admission))
                        throw new InvalidOperationException("UNKNOWN_JOB_MEMBER");
            }
            Console.Out.WriteLine("HOST:READY_MEMBERS:" + members.Length +
                ":NODE:" + node.Pid + ":CHILD:" + childPid);
            if (args[1]=="forced-failure")
                throw new InvalidOperationException("FORCED_NEGATIVE_TEST");

            node.WriteGo();
            line=node.ReadLine(15000);
            if (line!="RESULT:success:SYNTHETIC_ONLY:none")
                throw new InvalidOperationException("SYNTHETIC_RESULT_INVALID");
            if (!node.WaitExit(10000) || node.ExitCode()!=0)
                throw new InvalidOperationException("NODE_EXIT_INVALID");
            if (!job.WaitEmpty(12000))
                throw new InvalidOperationException("JOB_NOT_EMPTY_AFTER_SUCCESS");

            settled=true;
            Console.Out.WriteLine(line);
            Console.Out.WriteLine("HOST:SETTLED:0:NODE:" + node.Pid +
                ":DURATION_MS:" + watch.ElapsedMilliseconds);
            return 0;
        }
        catch(Exception ex)
        {
            if (Regex.IsMatch(ex.Message,@"^[A-Z][A-Z0-9_]{2,80}$"))
                failure=ex.Message;
            try { if (node!=null) node.TerminateOwned(); } catch {}
            try { if (job!=null) job.ForceTerminate(); } catch { failure="TERMINATION_UNKNOWN"; }
            bool processExit=false;
            try { processExit=node==null || node.WaitExit(3000); } catch {}
            try { settled=(job==null || job.WaitEmpty(3000)) && processExit; }
            catch { settled=false; }
            Console.Out.WriteLine("HOST:BLOCKED:" + failure + ":JOB_EMPTY:" +
                (settled?"1":"0"));
            return settled?3:4; // outside Job: OS exit must reflect negative test
        }
        finally
        {
            if (node!=null) node.Dispose();
            if (job!=null) job.Dispose();
        }
    }
}
