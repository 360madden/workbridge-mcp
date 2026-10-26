using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Workbridge
{
    // One private, non-inherited Job Object belongs to the native desktop host.
    // Closing its last handle (including on host death) terminates descendants.
    // The host may publish a settled receipt only while ActiveProcesses == 1.
    public static class DesktopJobLifetime
    {
        private static SafeFileHandle owner;

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

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(SafeFileHandle job, int infoClass, ref ExtendedLimits info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool IsProcessInJob(IntPtr process, SafeFileHandle job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(SafeFileHandle job, int infoClass, out BasicAccounting info, uint size, out uint returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetHandleInformation(IntPtr handle, out uint flags);
        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        public static void Attach()
        {
            if (owner != null) return;
            SafeFileHandle job = CreateJobObject(IntPtr.Zero, null);
            if (job == null || job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                // The lifetime handle must never be inherited by a spawned worker.
                if (!SetHandleInformation(job.DangerousGetHandle(), 1, 0))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                uint flags;
                if (!GetHandleInformation(job.DangerousGetHandle(), out flags) || (flags & 1) != 0)
                    throw new InvalidOperationException("Desktop Job handle inheritance is unverified.");
                ExtendedLimits limits = new ExtendedLimits();
                limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!AssignProcessToJobObject(job, GetCurrentProcess()))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                bool assigned;
                if (!IsProcessInJob(GetCurrentProcess(), job, out assigned) || !assigned)
                    throw new InvalidOperationException("Desktop host Job assignment is unverified.");
                if (ReadActive(job) != 1)
                    throw new InvalidOperationException("Desktop host Job must start with one process.");
                owner = job;
                job = null;
            }
            finally
            {
                // If failure occurs after assignment, closing this handle also
                // fails closed by terminating this host and any descendants.
                if (job != null) job.Dispose();
            }
        }

        public static uint ActiveProcesses()
        {
            if (owner == null || owner.IsInvalid || owner.IsClosed)
                throw new InvalidOperationException("Desktop host has no verified Job.");
            return ReadActive(owner);
        }

        private static uint ReadActive(SafeFileHandle job)
        {
            BasicAccounting info;
            uint returned;
            uint size = (uint)Marshal.SizeOf(typeof(BasicAccounting));
            if (!QueryInformationJobObject(job, 1, out info, size, out returned) || returned < size)
                throw new InvalidOperationException("Desktop process-tree accounting failed.");
            if (info.ActiveProcesses == 0)
                throw new InvalidOperationException("Desktop process-tree accounting lost its host.");
            return info.ActiveProcesses;
        }
    }
}
