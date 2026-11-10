using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using Microsoft.Win32.SafeHandles;

// Only the host uses this executable. Cua Driver still owns all UI actions and images.
static class CuaWindows {
    [StructLayout(LayoutKind.Sequential)]
    struct JobLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JobAccounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref JobLimits value, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out JobAccounting value, int size, IntPtr written);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern SafeFileHandle OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool IsProcessInJob(SafeFileHandle process, SafeFileHandle job, out bool member);

    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfo {
        public int Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, Width, Height, Columns, Rows, Fill, Flags;
        public ushort ShowWindow, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo {
        public IntPtr Process, Thread;
        public int Pid, Tid;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string file, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes,
        bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out int code);

    [StructLayout(LayoutKind.Sequential)]
    struct Bounds { public int Left, Top, Right, Bottom; }
    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Bounds bounds, int size);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Bounds bounds);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flag);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);

    static void Require(bool ok) { if (!ok) throw new Win32Exception(); }
    static string Hash(string value) {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
    }
    static string JobName(string directory) {
        Require(Path.IsPathRooted(directory) && Regex.IsMatch(Path.GetFileName(directory), @"\Ahomer-cua-[a-zA-Z0-9]{6}\z"));
        return @"Global\Homer.Cua." + Hash(directory.ToUpperInvariant());
    }
    static void Stop(SafeFileHandle job) {
        Require(TerminateJobObject(job, 1));
        var limit = Stopwatch.StartNew();
        do {
            JobAccounting status;
            Require(QueryInformationJobObject(job, 1, out status, Marshal.SizeOf(typeof(JobAccounting)), IntPtr.Zero));
            if (status.ActiveProcesses == 0) return;
            Thread.Sleep(30);
        } while (limit.ElapsedMilliseconds < 2000);
        throw new InvalidOperationException();
    }
    static void Hold(string directory) {
        bool ownerGone;
        // Keep the directory from being removed while job creation or shutdown is in progress.
        using (File.Open(Path.Combine(directory, "windows-job"), FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
            string name = JobName(directory);
            SetLastError(0); // .NET Framework preserves last error between native calls.
            using (var job = CreateJobObject(IntPtr.Zero, name)) {
                int error = Marshal.GetLastWin32Error();
                Require(!job.IsInvalid && error != 183);
                var limits = new JobLimits { Flags = 0x2000 }; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(JobLimits))));
                Console.WriteLine("ready");
                Console.Out.Flush();
                ownerGone = Console.In.Read() < 0;
                Stop(job);
            }
        }
        if (ownerGone) Directory.Delete(directory, true);
        Console.WriteLine("stopped");
    }
    static void Reclaim(string directory) {
        using (var job = OpenJobObject(0xC, false, JobName(directory))) { // QUERY | TERMINATE
            int error = Marshal.GetLastWin32Error();
            if (job.IsInvalid) Require(error == 2); // ERROR_FILE_NOT_FOUND
            else Stop(job);
        }
        Console.WriteLine("stopped");
    }
    static int Launch(string directory, string exe, string args, bool privateWorker) {
        // Join before spawning. The kernel then tracks every child, even if this launcher dies.
        using (var job = OpenJobObject(1, false, JobName(directory))) {
            Require(!job.IsInvalid && AssignProcessToJobObject(job, GetCurrentProcess()));
        }
        var startup = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfo)) };
        if (privateWorker) {
            startup.Flags = 0x100; // STARTF_USESTDHANDLES
            startup.Input = GetStdHandle(-10); startup.Output = GetStdHandle(-11); startup.Error = GetStdHandle(-12);
        }
        ProcessInfo child;
        Require(CreateProcess(exe, new StringBuilder("\"" + exe + "\" " + args), IntPtr.Zero, IntPtr.Zero,
            privateWorker, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(exe), ref startup, out child));
        CloseHandle(child.Thread);
        try {
            if (!privateWorker) { Console.WriteLine(child.Pid); return 0; }
            int code = 1;
            Require(WaitForSingleObject(child.Process, uint.MaxValue) == 0 && GetExitCodeProcess(child.Process, out code));
            return code;
        } finally { CloseHandle(child.Process); }
    }

    static string Value(AutomationElement element) {
        object pattern;
        return element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) ? ((ValuePattern)pattern).Current.Value ?? "" : "";
    }
    static void Inspect(string mode, int pid, IntPtr window, string isolated) {
        Require(SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero); // PER_MONITOR_AWARE_V2
        int owner;
        Require(GetWindowThreadProcessId(window, out owner) != 0 && owner == pid &&
            IsWindowVisible(window) && !IsIconic(window) && GetAncestor(window, 2) == window);
        if (mode == "frame") {
            Bounds raw;
            Require(GetWindowRect(window, out raw) && raw.Right > raw.Left && raw.Bottom > raw.Top);
            Console.WriteLine(new JavaScriptSerializer().Serialize(new {
                x = raw.Left, y = raw.Top, width = raw.Right - raw.Left, height = raw.Bottom - raw.Top
            }));
            return;
        }
        var name = new StringBuilder(128);
        Require(GetClassName(window, name, name.Capacity) != 0 && name.ToString() == "Chrome_WidgetWin_1");
        if (isolated != null) {
            using (var job = OpenJobObject(4, false, JobName(isolated)))
            using (var process = OpenProcess(0x1000, false, pid)) {
                bool member;
                Require(!job.IsInvalid && !process.IsInvalid && IsProcessInJob(process, job, out member) && member);
            }
        }
        if (mode == "window") { Console.WriteLine("window"); return; }
        var root = AutomationElement.FromHandle(window);
        if (mode == "address") {
            Require(GetForegroundWindow() == window);
            var edit = AutomationElement.FocusedElement;
            Require(edit != null && edit.Current.ProcessId == pid && edit.Current.ControlType == ControlType.Edit &&
                edit.Current.ClassName == "OmniboxViewViews" && edit.Current.HasKeyboardFocus);
            var node = edit;
            while (node != null && !node.Equals(root)) {
                Require(node.Current.ControlType != ControlType.Document);
                node = TreeWalker.RawViewWalker.GetParent(node);
            }
            string value = Value(edit);
            Require(node != null && edit.Equals(AutomationElement.FocusedElement) && GetForegroundWindow() == window);
            Console.WriteLine(Hash(value));
            return;
        }
        var documents = new TreeWalker(new AndCondition(
            new PropertyCondition(AutomationElement.AutomationIdProperty, "RootWebArea"),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document),
            new PropertyCondition(AutomationElement.IsOffscreenProperty, false)));
        var document = documents.GetFirstChild(root);
        Require(document != null && documents.GetNextSibling(document) == null);
        Rect view = document.Current.BoundingRectangle;
        Require(!view.IsEmpty);
        Bounds bounds;
        Require(DwmGetWindowAttribute(window, 9, out bounds, Marshal.SizeOf(typeof(Bounds))) == 0);
        int left = (int)Math.Ceiling(view.Left), top = (int)Math.Ceiling(view.Top);
        string url = Value(document);
        Uri uri;
        string origin = Uri.TryCreate(url, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http")
            ? uri.GetComponents(UriComponents.SchemeAndServer, UriFormat.UriEscaped) : null;
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            window = new { x = bounds.Left, y = bounds.Top, width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top },
            viewport = new { x = left, y = top, width = (int)Math.Floor(view.Right) - left, height = (int)Math.Floor(view.Bottom) - top },
            page = Hash(string.Join(",", document.GetRuntimeId()) + "\n" + url),
            origin
        }));
    }
    [MTAThread]
    static int Main(string[] args) {
        try {
            Console.OutputEncoding = new UTF8Encoding(false);
            switch (args[0]) {
                case "hold": Hold(args[1]); return 0;
                case "stop": Reclaim(args[1]); return 0;
                case "guest": return Launch(args[1], args[2], "\"--user-data-dir=" + Path.Combine(args[1], "profile") +
                    "\" --guest --no-first-run --no-default-browser-check about:blank", false);
                case "__private-worker":
                    Guid generation;
                    Require(args.Length == 3 && args[1] == "--generation" && Guid.TryParseExact(args[2], "D", out generation));
                    return Launch(Environment.GetEnvironmentVariable("CUA_DRIVER_RS_HOME"),
                        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "cua-driver.exe"), "__private-worker --generation " + args[2], true);
                case "page": case "address": case "window": case "frame":
                    Inspect(args[0], int.Parse(args[1]), new IntPtr(long.Parse(args[2])), args.Length == 4 ? args[3] : null); return 0;
            }
        } catch (Exception) { }
        return 1;
    }
}
