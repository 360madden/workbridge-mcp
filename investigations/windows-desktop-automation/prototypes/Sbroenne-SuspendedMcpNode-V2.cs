// M3-P6 ISOLATED Sbroenne MCP provider child launcher. Mechanical fork of v2
// SYNTHETIC-only suspended-node Win32 helper; retains exact STARTUPINFOEX
// handle allowlist and assign-before-resume ownership. No production code.
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

internal sealed class SbroenneSuspendedMcpNodeV2 : IDisposable
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

    private SbroenneSuspendedMcpNodeV2(int pid, SafeFileHandle process, SafeFileHandle thread,
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

    public static SbroenneSuspendedMcpNodeV2 Create(string node, string script, string mode, string manifest, string sampleId)
    {
        if ((mode != "protocol" && mode != "snapshot") ||
            (mode == "protocol" && manifest != "-") ||
            (mode == "snapshot" && !Path.IsPathRooted(manifest)))
            throw new InvalidOperationException("MCP_MODE_ARGUMENT_INVALID");
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
            StringBuilder command=new StringBuilder(Q(node)+" "+Q(script)+" "+
                Q(mode)+" "+Q(manifest)+" "+Q(sampleId),2048);
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
            var child=new SbroenneSuspendedMcpNodeV2(info.dwProcessId,
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
                if (c<0) throw new InvalidOperationException("MCP_PROTOCOL_EOF");
                if (c=='\n') return sb.ToString();
                if (c=='\0' || (c<32 && c!='\r')) throw new InvalidOperationException("MCP_PROTOCOL_INVALID");
                if (c!='\r') sb.Append((char)c);
                if (sb.Length>4096) throw new InvalidOperationException("MCP_PROTOCOL_TOO_LONG");
            }
        });
        if (!read.Wait(millis)) throw new InvalidOperationException("MCP_PROTOCOL_TIMEOUT");
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
