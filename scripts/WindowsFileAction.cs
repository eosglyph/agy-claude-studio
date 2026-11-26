using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
        private static extern int SHOpenFolderAndSelectItems(IntPtr pidl, uint count, IntPtr items, uint flags);

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

        private static bool RevealOnCurrentThread(string path)
        {
            IntPtr pidl = IntPtr.Zero;
            try
            {
                uint attrs;
                return SHParseDisplayName(path, IntPtr.Zero, out pidl, 0, out attrs) == 0 && pidl != IntPtr.Zero &&
                    SHOpenFolderAndSelectItems(pidl, 0, IntPtr.Zero, 0) == 0;
            }
            catch { return false; }
            finally { if (pidl != IntPtr.Zero) Marshal.FreeCoTaskMem(pidl); }
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
