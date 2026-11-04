// Investigation-only PRIVATE Job Object, adapted from the verified
// scripts/Desktop-JobLifetime.cs without editing production code.
// Adds read-only exact JobObjectBasicProcessIdList membership evidence.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Workbridge
{
    public static class SbroenneJobLifetime
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
            public UIntPtr ProcessMemory, JobMemory, PeakJobMemory, PeakProcessMemory;
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
        private static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref ExtendedLimits info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool IsProcessInJob(IntPtr process, SafeFileHandle job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out BasicAccounting info, uint size, out uint returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, IntPtr info, uint size, out uint returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetHandleInformation(IntPtr handle, out uint flags);
        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        public static void Attach()
        {
            if (owner != null) throw new InvalidOperationException("DUPLICATE_PRIVATE_JOB");
            SafeFileHandle job = CreateJobObject(IntPtr.Zero, null);
            if (job == null || job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                if (!SetHandleInformation(job.DangerousGetHandle(), 1, 0))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                uint flags;
                if (!GetHandleInformation(job.DangerousGetHandle(), out flags) || (flags & 1) != 0)
                    throw new InvalidOperationException("INHERITABLE_JOB_HANDLE");
                ExtendedLimits limits = new ExtendedLimits();
                limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) ||
                    !AssignProcessToJobObject(job, GetCurrentProcess()))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                bool assigned;
                if (!IsProcessInJob(GetCurrentProcess(), job, out assigned) || !assigned)
                    throw new InvalidOperationException("PRIVATE_JOB_ASSIGNMENT_UNVERIFIED");
                if (ReadActive(job) != 1)
                    throw new InvalidOperationException("PRIVATE_JOB_NONEMPTY_AT_ATTACH");
                owner = job;
                job = null;
            }
            finally
            {
                if (job != null) job.Dispose(); // kill-on-close if assignment already occurred
            }
        }

        public static uint ActiveProcesses()
        {
            if (owner == null || owner.IsClosed || owner.IsInvalid)
                throw new InvalidOperationException("PRIVATE_JOB_NOT_OWNED");
            return ReadActive(owner);
        }

        public static bool Contains(int pid)
        {
            using (Process process = Process.GetProcessById(pid))
            {
                bool included;
                if (!IsProcessInJob(process.Handle, owner, out included))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return included;
            }
        }

        public static int[] ActiveProcessIds()
        {
            if (owner == null || owner.IsInvalid || owner.IsClosed)
                throw new InvalidOperationException("PRIVATE_JOB_NOT_OWNED");
            int bytes = 4096;
            IntPtr buffer = Marshal.AllocHGlobal(bytes);
            try
            {
                uint returned;
                bool success = QueryInformationJobObject(owner, 3, buffer, (uint)bytes, out returned);
                if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
                int assigned = Marshal.ReadInt32(buffer, 0);
                int count = Marshal.ReadInt32(buffer, 4);
                if (assigned <= 0 || count <= 0 || count > 64 || count > assigned ||
                    8L + (long)count * IntPtr.Size > bytes)
                    throw new InvalidOperationException("PRIVATE_JOB_PID_LIST_INVALID");
                var ids = new List<int>();
                for (int i = 0; i < count; i++)
                {
                    long raw = Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
                    if (raw < 1 || raw > int.MaxValue)
                        throw new InvalidOperationException("PRIVATE_JOB_PID_INVALID");
                    int pid = (int)raw;
                    if (ids.Contains(pid))
                        throw new InvalidOperationException("PRIVATE_JOB_PID_DUPLICATE");
                    ids.Add(pid);
                }
                ids.Sort();
                return ids.ToArray();
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static uint ReadActive(SafeFileHandle job)
        {
            BasicAccounting info;
            uint returned;
            uint size = (uint)Marshal.SizeOf(typeof(BasicAccounting));
            if (!QueryInformationJobObject(job, 1, out info, size, out returned) ||
                returned < size || info.ActiveProcesses == 0)
                throw new InvalidOperationException("PRIVATE_JOB_ACCOUNTING_FAILED");
            return info.ActiveProcesses;
        }
    }
}
