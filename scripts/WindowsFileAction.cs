using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

namespace AgyClaudeStudio
{
    // Shared by the compiled watcher and the Node watcher (Windows PowerShell Add-Type).
    public static class WindowsFileAction
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern int SHParseDisplayName(string path, IntPtr context, out IntPtr pidl, uint mask, out uint attributes);
        [DllImport("shell32.dll", ExactSpelling = true)]
        private static extern IntPtr ILFindLastID(IntPtr pidl);
        [DllImport("shell32.dll", ExactSpelling = true)]
        private static extern int SHOpenFolderAndSelectItems(IntPtr pidlFolder, uint cidl, [MarshalAs(UnmanagedType.LPArray)] IntPtr[] apidl, uint dwFlags);
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern bool AllowSetForegroundWindow(uint dwProcessId);
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("kernel32.dll", ExactSpelling = true)]
        private static extern uint GetCurrentThreadId();
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        private const uint ASFW_ANY = 0xFFFFFFFF;
        private const int SW_RESTORE = 9;

        private static readonly HashSet<string> Allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".html", ".htm", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
            ".ico", ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".mp4", ".mov", ".mkv", ".webm",
            ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml",
            ".log", ".ini", ".cfg", ".conf", ".css", ".sql", ".diff", ".patch", ".rtf", ".doc",
            ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".tar", ".gz", ".7z"
        };

        public static string Validate(string raw, string mode)
        {
            try
            {
                if (mode != "open" && mode != "reveal" || raw == null || raw.Length > 4096 ||
                    !raw.StartsWith("file:///", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("file:////") ||
                    Regex.IsMatch(raw, @"[\x00-\x1f\x7f""\\]")) return null;
                Uri uri = new Uri(raw, UriKind.Absolute);
                if (!uri.IsFile || uri.IsUnc || uri.Host.Length != 0) return null;
                // Decode once, including drive letters encoded by the chat renderer.
                string path = Uri.UnescapeDataString(raw.Substring(8).Split('#', '?')[0]).Replace('/', '\\');
                if (!Regex.IsMatch(path, @"^[a-zA-Z]:\\") || Regex.IsMatch(path.Substring(2), @"[:\x00-\x1f\x7f""<>|?*]")) return null;
                string root = Path.GetPathRoot(path);
                DriveType drive = new DriveInfo(root).DriveType;
                if (drive != DriveType.Fixed && drive != DriveType.Removable && drive != DriveType.CDRom && drive != DriveType.Ram) return null;
                string current = root;
                FileAttributes attrs = File.GetAttributes(root);
                foreach (string part in path.Substring(root.Length).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    if (part.EndsWith(".") || part.EndsWith(" ") || Regex.IsMatch(part, @"^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase)) return null;
                    current = Path.Combine(current, part);
                    attrs = File.GetAttributes(current);
                    if ((attrs & FileAttributes.ReparsePoint) != 0) return null;
                }
                if (mode == "open" && (attrs & FileAttributes.Directory) == 0 && !Allowed.Contains(Path.GetExtension(current))) return null;
                return current;
            }
            catch { return null; }
        }

        private static string NormalizeDirForCompare(string dirPath)
        {
            if (string.IsNullOrEmpty(dirPath)) return "";
            try
            {
                string full = Path.GetFullPath(dirPath);
                if (full.Length > 3) full = full.TrimEnd('\\', '/');
                return full;
            }
            catch { return dirPath.TrimEnd('\\', '/'); }
        }

        private static IntPtr FindExplorerWindowForFolder(string folderPath)
        {
            string target = NormalizeDirForCompare(folderPath);
            if (string.IsNullOrEmpty(target)) return IntPtr.Zero;
            try
            {
                Type shellType = Type.GetTypeFromProgID("Shell.Application");
                if (shellType == null) return IntPtr.Zero;
                object shell = Activator.CreateInstance(shellType);
                if (shell == null) return IntPtr.Zero;
                object windows = shellType.InvokeMember("Windows", BindingFlags.InvokeMethod, null, shell, null);
                IEnumerable enumerable = windows as IEnumerable;
                if (enumerable == null) return IntPtr.Zero;
                IntPtr matched = IntPtr.Zero;
                foreach (object win in enumerable)
                {
                    if (win == null) continue;
                    try
                    {
                        Type winType = win.GetType();
                        string locUrl = winType.InvokeMember("LocationURL", BindingFlags.GetProperty, null, win, null) as string;
                        if (string.IsNullOrEmpty(locUrl)) continue;
                        Uri u;
                        if (!Uri.TryCreate(locUrl, UriKind.Absolute, out u) || !u.IsFile) continue;
                        string winPath = NormalizeDirForCompare(u.LocalPath);
                        if (!string.Equals(winPath, target, StringComparison.OrdinalIgnoreCase)) continue;
                        object hwndObj = winType.InvokeMember("HWND", BindingFlags.GetProperty, null, win, null);
                        if (hwndObj != null)
                        {
                            long rawHwnd = Convert.ToInt64(hwndObj);
                            if (rawHwnd != 0) matched = new IntPtr(rawHwnd);
                        }
                    }
                    catch { }
                }
                return matched;
            }
            catch { return IntPtr.Zero; }
        }

        private static void BringWindowToForeground(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return;
            try
            {
                if (GetForegroundWindow() == hwnd) return;
                if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);

                IntPtr fgHwnd = GetForegroundWindow();
                uint unusedPid;
                uint fgThread = (fgHwnd != IntPtr.Zero) ? GetWindowThreadProcessId(fgHwnd, out unusedPid) : 0;
                uint targetThread = GetWindowThreadProcessId(hwnd, out unusedPid);
                uint curThread = GetCurrentThreadId();

                bool attachedFg = (fgThread != 0 && fgThread != curThread) && AttachThreadInput(curThread, fgThread, true);
                bool attachedTarget = (targetThread != 0 && targetThread != curThread && targetThread != fgThread) && AttachThreadInput(curThread, targetThread, true);
                try
                {
                    BringWindowToTop(hwnd);
                    SetForegroundWindow(hwnd);
                }
                finally
                {
                    if (attachedTarget) AttachThreadInput(curThread, targetThread, false);
                    if (attachedFg) AttachThreadInput(curThread, fgThread, false);
                }
            }
            catch { }
        }

        private static void ActivateRevealedExplorer(string folderPath)
        {
            Thread.Sleep(80);
            for (int attempt = 0; attempt < 6; attempt++)
            {
                IntPtr hwnd = FindExplorerWindowForFolder(folderPath);
                if (hwnd != IntPtr.Zero)
                {
                    BringWindowToForeground(hwnd);
                    return;
                }
                Thread.Sleep(60);
            }
        }

        private static bool RevealOnCurrentThread(string path)
        {
            IntPtr folderPidl = IntPtr.Zero;
            IntPtr itemPidl = IntPtr.Zero;
            try
            {
                try { AllowSetForegroundWindow(ASFW_ANY); } catch { }
                uint attrs;
                string parentDir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(parentDir))
                {
                    if (SHParseDisplayName(parentDir, IntPtr.Zero, out folderPidl, 0, out attrs) != 0 || folderPidl == IntPtr.Zero)
                    {
                        return false;
                    }
                    if (SHParseDisplayName(path, IntPtr.Zero, out itemPidl, 0, out attrs) != 0 || itemPidl == IntPtr.Zero)
                    {
                        return false;
                    }
                    IntPtr childPidl = ILFindLastID(itemPidl);
                    if (childPidl == IntPtr.Zero) return false;
                    IntPtr[] items = new IntPtr[] { childPidl };
                    if (SHOpenFolderAndSelectItems(folderPidl, 1, items, 0) != 0)
                    {
                        return false;
                    }
                    ActivateRevealedExplorer(parentDir);
                    return true;
                }
                if (SHParseDisplayName(path, IntPtr.Zero, out folderPidl, 0, out attrs) == 0 && folderPidl != IntPtr.Zero &&
                    SHOpenFolderAndSelectItems(folderPidl, 0, null, 0) == 0)
                {
                    ActivateRevealedExplorer(path);
                    return true;
                }
                return false;
            }
            catch { return false; }
            finally
            {
                if (itemPidl != IntPtr.Zero) Marshal.FreeCoTaskMem(itemPidl);
                if (folderPidl != IntPtr.Zero) Marshal.FreeCoTaskMem(folderPidl);
            }
        }

        internal static bool RunInSta(Func<bool> action)
        {
            if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
            {
                return action();
            }
            bool ok = false;
            Thread sta = new Thread(delegate() { ok = action(); });
            sta.IsBackground = true;
            sta.SetApartmentState(ApartmentState.STA);
            sta.Start();
            sta.Join();
            return ok;
        }

        public static bool Run(string raw, string mode)
        {
            string path = Validate(raw, mode);
            if (path == null) return false;
            try
            {
                if (mode == "open")
                {
                    // ShellExecute's file parameter is separate from command-line arguments.
                    using (Process process = Process.Start(new ProcessStartInfo(path) { UseShellExecute = true, Verb = "open" })) { }
                    return true;
                }
                return RunInSta(delegate { return RevealOnCurrentThread(path); });
            }
            catch { return false; }
        }
    }
}
