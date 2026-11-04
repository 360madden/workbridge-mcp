// M3-P5 isolated SYNTHETIC-ONLY private Job helper. Does not alter Workbridge production.
// Owner stays OUTSIDE the private KILL_ON_JOB_CLOSE Job; children assigned suspended.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal sealed class SbroennePrivateJobV2 : IDisposable
{
    private SafeFileHandle handle;
    private bool closed;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicAccounting
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodUserTime, ThisPeriodKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool IsProcessInJob(IntPtr process, SafeFileHandle job, out bool included);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out BasicAccounting info, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, IntPtr info, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    private SbroennePrivateJobV2(SafeFileHandle owned) { handle = owned; }

    public static SbroennePrivateJobV2 Create()
    {
        SafeFileHandle job = CreateJobObject(IntPtr.Zero, null);
        if (job == null || job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            if (!SetHandleInformation(job.DangerousGetHandle(), 1, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            uint flags;
            if (!GetHandleInformation(job.DangerousGetHandle(), out flags) || (flags & 1) != 0)
                throw new InvalidOperationException("JOB_HANDLE_INHERITABLE");
            ExtendedLimits limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE, never BREAKAWAY
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            bool selfMember;
            if (!IsProcessInJob(GetCurrentProcess(), job, out selfMember) || selfMember)
                throw new InvalidOperationException("HOST_INSIDE_PRIVATE_JOB");
            var privateJob = new SbroennePrivateJobV2(job);
            if (privateJob.Active() != 0 || privateJob.Members().Length != 0)
                throw new InvalidOperationException("JOB_NOT_EMPTY_AT_CREATE");
            job = null; // ownership transferred
            return privateJob;
        }
        finally { if (job != null) job.Dispose(); }
    }

    public void AssignSuspended(IntPtr childProcess, int childPid)
    {
        if (childPid <= 0 || Active() != 0 || Members().Length != 0)
            throw new InvalidOperationException("JOB_NOT_EMPTY_BEFORE_ASSIGN");
        if (!AssignProcessToJobObject(handle, childProcess))
            throw new InvalidOperationException("JOB_ASSIGN_FAILED_" + Marshal.GetLastWin32Error());
        if (!Contains(childProcess))
            throw new InvalidOperationException("CHILD_NOT_IN_PRIVATE_JOB");
        int[] members = Snapshot();
        if (members.Length != 1 || members[0] != childPid)
            throw new InvalidOperationException("SUSPENDED_ASSIGN_NOT_EXACT");
        if (Contains(GetCurrentProcess()))
            throw new InvalidOperationException("HOST_ENTERED_PRIVATE_JOB");
    }

    public bool Contains(IntPtr process)
    {
        bool found;
        if (!IsProcessInJob(process, handle, out found))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return found;
    }

    public int Active()
    {
        BasicAccounting info;
        uint bytes;
        int size = Marshal.SizeOf(typeof(BasicAccounting));
        if (!QueryInformationJobObject(handle, 1, out info, (uint)size, out bytes) || bytes < size)
            throw new InvalidOperationException("JOB_ACCOUNTING_FAILED");
        if (info.ActiveProcesses > 64)
            throw new InvalidOperationException("JOB_MEMBERS_TOO_MANY");
        return (int)info.ActiveProcesses; // zero is valid when host is outside private Job
    }

    public int[] Members()
    {
        for (int length = 256; length <= 8192; length *= 2)
        {
            IntPtr ptr = Marshal.AllocHGlobal(length);
            try
            {
                uint bytes;
                bool ok = QueryInformationJobObject(handle, 3, ptr, (uint)length, out bytes);
                if (!ok)
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error == 122 || error == 234) continue;
                    throw new InvalidOperationException("JOB_PID_QUERY_FAILED_" + error);
                }
                if (bytes < 8 || bytes > length)
                    throw new InvalidOperationException("JOB_PID_RETURNED_LENGTH_INVALID");
                int assigned = Marshal.ReadInt32(ptr, 0);
                int count = Marshal.ReadInt32(ptr, 4);
                if (assigned < 0 || assigned > 64 || count < 0 || count > assigned)
                    throw new InvalidOperationException("JOB_PID_HEADER_INVALID");
                if (count < assigned || 8L + (long)count * IntPtr.Size > length ||
                    8L + (long)count * IntPtr.Size > bytes) continue;
                var ids = new List<int>(count);
                for (int i = 0; i < count; i++)
                {
                    long raw = Marshal.ReadIntPtr(ptr, 8 + i * IntPtr.Size).ToInt64();
                    if (raw <= 0 || raw > int.MaxValue || ids.Contains((int)raw))
                        throw new InvalidOperationException("JOB_PID_VALUE_INVALID");
                    ids.Add((int)raw);
                }
                ids.Sort();
                return ids.ToArray();
            }
            finally { Marshal.FreeHGlobal(ptr); }
        }
        throw new InvalidOperationException("JOB_PID_LIST_INCOMPLETE");
    }

    // Bound accounting/list races; never silently accept a partial PID list.
    public int[] Snapshot()
    {
        for (int i = 0; i < 20; i++)
        {
            try
            {
                int before = Active();
                int[] ids = Members();
                if (before == Active() && ids.Length == before) return ids;
            }
            catch (InvalidOperationException ex)
            {
                if (!ex.Message.StartsWith("JOB_PID_", StringComparison.Ordinal)) throw;
            }
            Thread.Sleep(25);
        }
        throw new InvalidOperationException("JOB_SNAPSHOT_UNSTABLE");
    }

    public bool WaitEmpty(int millis)
    {
        var watch = Stopwatch.StartNew();
        int stable = 0;
        while (watch.ElapsedMilliseconds < millis)
        {
            try
            {
                if (Snapshot().Length == 0 && Active() == 0) {
                    if (++stable >= 3) return true;
                } else stable = 0;
            }
            catch { stable = 0; }
            Thread.Sleep(40);
        }
        return false;
    }

    public void ForceTerminate()
    {
        if (handle != null && !handle.IsInvalid && !handle.IsClosed)
            if (!TerminateJobObject(handle, 3))
                throw new InvalidOperationException("JOB_TERMINATE_FAILED_" + Marshal.GetLastWin32Error());
    }
    public void Dispose()
    {
        if (closed) return;
        closed = true;
        if (handle != null) handle.Dispose(); // kill remaining child members; never kills host
    }
}
