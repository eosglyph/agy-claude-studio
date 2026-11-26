using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AgyClaudeStudio.Installer
{
    internal class InstallerOptions
    {
        public bool Uninstall;
        public bool Silent;
        public bool Popup;
        public bool StatusOnly;
        public bool NoAutostart;
        public bool NoKillLegacy;
        public string InstallDir;
        public string AntigravityExe;
        public int? CdpPort;
        public string OutFile;
        public bool DesktopShortcut = true;
        public bool NoDesktopShortcut;
    }

    internal class AntigravityDetectResult
    {
        public string ExePath;
        public string Version;
        public bool IsRunning;
    }

    internal class LegacyDetectSummary
    {
        public bool HasLegacyStyleStandalone;
        public bool HasLegacyStudioStandalone;
        public bool HasLegacyStylePlugin;
        public List<string> Items = new List<string>();
    }

    internal class OperationResult
    {
        public bool Ok;
        public string Mode;
        public string InstallType = "native-plugin";
        public string LauncherShortcutPath;
        public string DesktopShortcutPath;
        public string ShortcutIconPath;
        public string Headline;
        public string Detail;
        public string InstallDir;
        public string PluginDataDir;
        public string UninstallerExePath;
        public string AntigravityExe;
        public string AntigravityVersion;
        public bool AntigravityRunning;
        public bool AntigravityRunningWithoutCdp;
        public bool HostPluginEnabled;
        public int? CdpPort;
        public List<string> InjectedPages = new List<string>();
        public List<string> CleanedLegacyItems = new List<string>();
        public bool PreservedExistingConfig;
        public string MigratedConfigFrom;
        public bool SelfDeleteScheduled;
        public string ConfigSummary;
    }

    internal static class InstallerCore
    {
        private const string UninstallRegSubKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AGYClaudeStudio";
        private const string LegacyStyleUninstallRegSubKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AGYClaudeStyle";
        private const string LauncherLnkName = "Antigravity (Claude Studio).lnk";
        private const string SelfInstalledExeName = "agy-claude-studio-installer.exe";
        private const string GeminiIconRelPath = @"assets\agy-gemini-clawd.ico";

        private static readonly string[] LegacyStartupLnkNames = new string[]
        {
            "AGY-Claude-Style.lnk",
            "Claude-Style.lnk",
            "Claude-Studio.lnk",
            "agy-claude-style.lnk",
            "agy-claude-studio.lnk"
        };

        private static readonly string[] LegacyLauncherLnkNames = new string[]
        {
            "Antigravity (AGY Claude Style).lnk",
            "Antigravity (Claude Style).lnk"
        };

        public static string GetTestSystemRoot()
        {
            string root = Environment.GetEnvironmentVariable("AGY_CS_TEST_SYSTEM_ROOT");
            if (string.IsNullOrEmpty(root)) return null;
            string trimmed = root.Trim();
            return string.IsNullOrEmpty(trimmed) ? null : Path.GetFullPath(trimmed);
        }

        public static string GetUserProfileDir()
        {
            string testRoot = GetTestSystemRoot();
            if (!string.IsNullOrEmpty(testRoot))
            {
                return Path.Combine(testRoot, "UserProfile");
            }
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (string.IsNullOrEmpty(home)) home = Environment.GetEnvironmentVariable("USERPROFILE");
            return home;
        }

        public static string GetLocalAppDataDir()
        {
            string testRoot = GetTestSystemRoot();
            if (!string.IsNullOrEmpty(testRoot))
            {
                return Path.Combine(testRoot, "LocalAppData");
            }
            string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (string.IsNullOrEmpty(localAppData))
            {
                localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            }
            return localAppData;
        }

        public static string GetDefaultInstallDir()
        {
            return Path.Combine(GetUserProfileDir(), ".gemini", "config", "plugins", "agy-claude-studio");
        }

        public static string GetPluginDataDir()
        {
            return Path.Combine(GetUserProfileDir(), ".gemini", "antigravity", "plugin_data", "agy-claude-studio");
        }

        public static string GetLegacyStylePluginDataDir()
        {
            return Path.Combine(GetUserProfileDir(), ".gemini", "antigravity", "plugin_data", "agy-claude-style");
        }

        public static string GetLegacyStylePluginDir()
        {
            return Path.Combine(GetUserProfileDir(), ".gemini", "config", "plugins", "agy-claude-style");
        }

        public static string GetLegacyStyleStandaloneDir()
        {
            return Path.Combine(GetLocalAppDataDir(), "agy-claude-style");
        }

        public static string GetLegacyStudioStandaloneDir()
        {
            return Path.Combine(GetLocalAppDataDir(), "agy-claude-studio");
        }

        public static string GetUninstallerDir()
        {
            return Path.Combine(GetLocalAppDataDir(), "agy-claude-studio-setup");
        }

        public static string GetHostConfigPath()
        {
            string envPath = Environment.GetEnvironmentVariable("AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG");
            if (!string.IsNullOrEmpty(envPath) && !string.IsNullOrEmpty(envPath.Trim()))
            {
                return Path.GetFullPath(envPath.Trim());
            }
            return Path.Combine(GetUserProfileDir(), ".gemini", "config", "config.json");
        }

        public static string GetStartupDir()
        {
            string testRoot = GetTestSystemRoot();
            return !string.IsNullOrEmpty(testRoot)
                ? Path.Combine(testRoot, "Startup")
                : Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        }

        public static string GetStartMenuDir()
        {
            string testRoot = GetTestSystemRoot();
            return !string.IsNullOrEmpty(testRoot)
                ? Path.Combine(testRoot, "StartMenu")
                : Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        }

        public static string GetDesktopDir()
        {
            string testRoot = GetTestSystemRoot();
            return !string.IsNullOrEmpty(testRoot)
                ? Path.Combine(testRoot, "Desktop")
                : Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }

        public static string GetStartMenuLauncherShortcutPath()
        {
            return Path.Combine(GetStartMenuDir(), LauncherLnkName);
        }

        public static string GetDesktopLauncherShortcutPath()
        {
            return Path.Combine(GetDesktopDir(), LauncherLnkName);
        }

        public static bool IsNativePluginInstalled(string installDir)
        {
            if (string.IsNullOrEmpty(installDir) || !Directory.Exists(installDir)) return false;
            return File.Exists(Path.Combine(installDir, "plugin.json")) &&
                   File.Exists(Path.Combine(installDir, "sidecars", "studio", "main.mjs"));
        }

        public static string GetDirHash(string dir)
        {
            return CdpHelper.ComputeHash(Path.GetFullPath(dir).TrimEnd('\\', '/').ToLowerInvariant());
        }

        public static bool PathsEqual(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            try
            {
                string na = Path.GetFullPath(a).TrimEnd('\\', '/');
                string nb = Path.GetFullPath(b).TrimEnd('\\', '/');
                return string.Equals(na, nb, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        public static LegacyDetectSummary DetectLegacyInstalls(string targetInstallDir)
        {
            LegacyDetectSummary summary = new LegacyDetectSummary();
            string styleStandalone = GetLegacyStyleStandaloneDir();
            if (Directory.Exists(styleStandalone) && !PathsEqual(styleStandalone, targetInstallDir))
            {
                summary.HasLegacyStyleStandalone = true;
                summary.Items.Add("v2.1.0 独立安装 (" + styleStandalone + ")");
            }
            string studioStandalone = GetLegacyStudioStandaloneDir();
            if (Directory.Exists(studioStandalone) && !PathsEqual(studioStandalone, targetInstallDir))
            {
                summary.HasLegacyStudioStandalone = true;
                summary.Items.Add("v2.2.0/v2.2.1 独立安装 (" + studioStandalone + ")");
            }
            string stylePlugin = GetLegacyStylePluginDir();
            if (Directory.Exists(stylePlugin) && !PathsEqual(stylePlugin, targetInstallDir))
            {
                summary.HasLegacyStylePlugin = true;
                summary.Items.Add("旧版 agy-claude-style 插件 (" + stylePlugin + ")");
            }
            return summary;
        }

        public static AntigravityDetectResult DetectAntigravityDesktop(string overrideExe)
        {
            AntigravityDetectResult res = new AntigravityDetectResult();
            try
            {
                Process[] procs = Process.GetProcessesByName("Antigravity");
                if (procs != null && procs.Length > 0)
                {
                    res.IsRunning = true;
                    for (int i = 0; i < procs.Length; i++)
                    {
                        try { procs[i].Dispose(); } catch { }
                    }
                }
            }
            catch { }

            if (!string.IsNullOrEmpty(overrideExe))
            {
                string trimmed = overrideExe.Trim().Trim('"');
                if (!string.IsNullOrEmpty(trimmed) && File.Exists(trimmed))
                {
                    res.ExePath = Path.GetFullPath(trimmed);
                }
            }

            if (string.IsNullOrEmpty(res.ExePath))
            {
                res.ExePath = CdpHelper.FindAntigravityExePath();
            }

            if (!string.IsNullOrEmpty(res.ExePath) && File.Exists(res.ExePath))
            {
                try
                {
                    FileVersionInfo fvi = FileVersionInfo.GetVersionInfo(res.ExePath);
                    res.Version = !string.IsNullOrEmpty(fvi.FileVersion) ? fvi.FileVersion : fvi.ProductVersion;
                }
                catch { }
                if (string.IsNullOrEmpty(res.Version))
                {
                    try
                    {
                        string dir = Path.GetDirectoryName(res.ExePath);
                        string versionFile = Path.Combine(dir, "version");
                        if (File.Exists(versionFile))
                        {
                            res.Version = File.ReadAllText(versionFile, Encoding.UTF8).Trim();
                        }
                    }
                    catch { }
                }
            }

            return res;
        }

        public static string ResolveShortcutIconPath(string installDir, string antigravityExe)
        {
            if (!string.IsNullOrEmpty(installDir))
            {
                string geminiIco = Path.Combine(installDir, GeminiIconRelPath);
                if (File.Exists(geminiIco)) return geminiIco;
            }
            if (!string.IsNullOrEmpty(antigravityExe) && File.Exists(antigravityExe))
            {
                return antigravityExe;
            }
            return null;
        }

        public static bool CreateDirectAntigravityShortcut(string lnkPath, string antigravityExe, string iconPath)
        {
            if (string.IsNullOrEmpty(lnkPath) || string.IsNullOrEmpty(antigravityExe) || !File.Exists(antigravityExe))
            {
                return false;
            }
            try
            {
                string parent = Path.GetDirectoryName(lnkPath);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                string workDir = Path.GetDirectoryName(antigravityExe);
                string effectiveIcon = (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath))
                    ? iconPath
                    : antigravityExe;

                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(shellType);
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                Type lnkType = lnk.GetType();
                lnkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { antigravityExe });
                lnkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { "--remote-debugging-port=0" });
                lnkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir ?? "" });
                lnkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { effectiveIcon + ",0" });
                lnkType.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "启动 Antigravity Desktop（已开启 Claude Studio 原生插件 CDP 端口）" });
                lnkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                return File.Exists(lnkPath);
            }
            catch
            {
                return false;
            }
        }

        private static string ReadShortcutTargetPath(string lnkPath)
        {
            try
            {
                if (!File.Exists(lnkPath)) return null;
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(shellType);
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                return lnk.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, lnk, null) as string;
            }
            catch
            {
                return null;
            }
        }

        private static bool IsBrokenLegacyWatcherShortcut(string lnkPath)
        {
            string target = ReadShortcutTargetPath(lnkPath);
            if (string.IsNullOrEmpty(target)) return false;
            string name = Path.GetFileName(target);
            if (string.Equals(name, "agy-claude-studio-watcher.exe", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(name, "agy-claude-style-watcher.exe", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            return false;
        }

        private static bool IsExecutableInsideDir(string exePath, string dir)
        {
            if (string.IsNullOrEmpty(exePath) || string.IsNullOrEmpty(dir)) return false;
            try
            {
                string normExe = Path.GetFullPath(exePath);
                string normDir = Path.GetFullPath(dir).TrimEnd('\\', '/') + "\\";
                return normExe.StartsWith(normDir, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        public static void StopProcessesInDirectory(string dir, Action<string> log)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;
            int selfPid = Process.GetCurrentProcess().Id;
            string normDir = Path.GetFullPath(dir).TrimEnd('\\', '/');
            string hash = GetDirHash(normDir);

            // Signal known watcher stop events gently first.
            string[] eventPrefixes = new string[] { "Local\\AGYClaudeStudioStop_", "Local\\AGYClaudeStyleStop_" };
            for (int e = 0; e < eventPrefixes.Length; e++)
            {
                try
                {
                    using (EventWaitHandle stopEvt = EventWaitHandle.OpenExisting(eventPrefixes[e] + hash))
                    {
                        stopEvt.Set();
                    }
                }
                catch { }
            }

            // 1. Check .watch.pid with strict ownership verification.
            string pidFile = Path.Combine(normDir, ".watch.pid");
            if (File.Exists(pidFile))
            {
                bool deletePid = false;
                try
                {
                    int pid;
                    if (!int.TryParse(File.ReadAllText(pidFile, Encoding.UTF8).Trim(), out pid) || pid <= 0)
                    {
                        deletePid = true;
                    }
                    else if (pid != selfPid)
                    {
                        CdpHelper.WatcherPidClassification cls = CdpHelper.ClassifyWatcherPid(pid, normDir);
                        if (cls.Status == CdpHelper.WatcherPidStatus.Owned)
                        {
                            try
                            {
                                using (Process p = Process.GetProcessById(pid))
                                {
                                    if (!p.WaitForExit(1500))
                                    {
                                        p.Kill();
                                        p.WaitForExit(1500);
                                    }
                                    if (log != null) log("已停止旧版守护进程 (PID " + pid + ")");
                                }
                            }
                            catch { }
                            deletePid = true;
                        }
                        else if (cls.Status == CdpHelper.WatcherPidStatus.Dead || cls.Status == CdpHelper.WatcherPidStatus.Foreign)
                        {
                            deletePid = true;
                        }
                    }
                }
                catch { }
                if (deletePid)
                {
                    try { File.Delete(pidFile); } catch { }
                }
            }

            // 2. Stop legacy standalone C# watchers whose executable resides inside dir.
            string[] watcherNames = new string[] { "agy-claude-studio-watcher", "agy-claude-style-watcher" };
            for (int w = 0; w < watcherNames.Length; w++)
            {
                try
                {
                    Process[] procs = Process.GetProcessesByName(watcherNames[w]);
                    for (int i = 0; i < procs.Length; i++)
                    {
                        try
                        {
                            if (procs[i].Id == selfPid) continue;
                            string exe = null;
                            try { exe = procs[i].MainModule.FileName; } catch { }
                            bool owned = IsExecutableInsideDir(exe, normDir);
                            if (!owned)
                            {
                                CdpHelper.WatcherPidClassification cls = CdpHelper.ClassifyWatcherPid(procs[i].Id, normDir);
                                owned = (cls.Status == CdpHelper.WatcherPidStatus.Owned);
                            }
                            if (owned)
                            {
                                if (!procs[i].WaitForExit(1200))
                                {
                                    procs[i].Kill();
                                    procs[i].WaitForExit(1500);
                                }
                                if (log != null) log("已终止旧版独立守护进程 " + watcherNames[w] + ".exe (PID " + procs[i].Id + ")");
                            }
                        }
                        catch { }
                        finally
                        {
                            try { procs[i].Dispose(); } catch { }
                        }
                    }
                }
                catch { }
            }

            // 3. Stop node.exe scripts whose entry script path resides strictly inside normDir.
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"))
                {
                    foreach (ManagementObject obj in searcher.Get())
                    {
                        try
                        {
                            string cmd = obj["CommandLine"] as string;
                            if (string.IsNullOrWhiteSpace(cmd)) continue;
                            int pid = Convert.ToInt32(obj["ProcessId"]);
                            if (pid <= 0 || pid == selfPid) continue;

                            List<string> args = CdpHelper.SplitCommandArgs(cmd);
                            if (args.Count < 2) continue;
                            string scriptArg = null;
                            for (int a = 1; a < args.Count; a++)
                            {
                                if (string.IsNullOrEmpty(args[a]) || args[a].StartsWith("-", StringComparison.Ordinal)) continue;
                                scriptArg = args[a];
                                break;
                            }
                            if (string.IsNullOrEmpty(scriptArg) || !Path.IsPathRooted(scriptArg)) continue;
                            if (!IsExecutableInsideDir(scriptArg, normDir)) continue;

                            string scriptName = Path.GetFileName(scriptArg);
                            bool isKnownPluginScript =
                                string.Equals(scriptName, "inject.js", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(scriptName, "lifecycle.js", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(scriptName, "mcp-host.js", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(scriptName, "main.mjs", StringComparison.OrdinalIgnoreCase);
                            if (!isKnownPluginScript) continue;

                            try
                            {
                                using (Process p = Process.GetProcessById(pid))
                                {
                                    p.Kill();
                                    p.WaitForExit(1500);
                                }
                                if (log != null) log("已停止旧版插件 Node 进程 (" + scriptName + ", PID " + pid + ")");
                            }
                            catch { }
                        }
                        catch { }
                        finally
                        {
                            obj.Dispose();
                        }
                    }
                }
            }
            catch { }
        }

        private static bool IsValidJsonObjectFile(string filePath)
        {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return false;
            try
            {
                string raw = File.ReadAllText(filePath, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(raw)) return false;
                Dictionary<string, object> parsed = MiniJson.ParseObject(raw);
                return parsed != null && parsed.Count > 0;
            }
            catch
            {
                return false;
            }
        }

        public static void PreserveOrMigrateUserConfig(string installDir, OperationResult result, Action<string> log)
        {
            string pluginDataDir = GetPluginDataDir();
            result.PluginDataDir = pluginDataDir;
            Directory.CreateDirectory(pluginDataDir);
            string targetCfg = Path.Combine(pluginDataDir, "config.json");

            if (File.Exists(targetCfg))
            {
                result.PreservedExistingConfig = true;
                if (log != null) log("已保留现有插件用户配置: " + targetCfg);
                return;
            }

            string[] migrationCandidates = new string[]
            {
                Path.Combine(GetLegacyStudioStandaloneDir(), "config.json"),
                Path.Combine(installDir, "config.json"),
                Path.Combine(GetLegacyStylePluginDataDir(), "config.json"),
                Path.Combine(GetLegacyStyleStandaloneDir(), "config.json")
            };

            for (int i = 0; i < migrationCandidates.Length; i++)
            {
                string candidate = migrationCandidates[i];
                if (PathsEqual(candidate, targetCfg)) continue;
                if (!IsValidJsonObjectFile(candidate)) continue;
                try
                {
                    File.Copy(candidate, targetCfg, false);
                    result.PreservedExistingConfig = true;
                    result.MigratedConfigFrom = candidate;
                    if (log != null) log("已从旧版无损迁移用户配置至 plugin_data: " + candidate);
                    return;
                }
                catch { }
            }
        }

        public static void CleanupLegacyInstallations(string targetInstallDir, OperationResult result, Action<string> log)
        {
            // 1. Clean legacy v2.1.0 standalone (%LOCALAPPDATA%\agy-claude-style)
            string styleStandalone = GetLegacyStyleStandaloneDir();
            if (Directory.Exists(styleStandalone) && !PathsEqual(styleStandalone, targetInstallDir))
            {
                StopProcessesInDirectory(styleStandalone, log);
                try
                {
                    Directory.Delete(styleStandalone, true);
                    result.CleanedLegacyItems.Add("legacy-standalone:agy-claude-style");
                    if (log != null) log("已清理 v2.1.0 旧版独立目录: " + styleStandalone);
                }
                catch (Exception ex)
                {
                    if (log != null) log("[!] 清理旧目录部分受限 (" + styleStandalone + "): " + ex.Message);
                }
            }

            // 2. Clean legacy v2.2.0 / v2.2.1 standalone (%LOCALAPPDATA%\agy-claude-studio)
            string studioStandalone = GetLegacyStudioStandaloneDir();
            if (Directory.Exists(studioStandalone) && !PathsEqual(studioStandalone, targetInstallDir))
            {
                StopProcessesInDirectory(studioStandalone, log);
                try
                {
                    Directory.Delete(studioStandalone, true);
                    result.CleanedLegacyItems.Add("legacy-standalone:agy-claude-studio");
                    if (log != null) log("已清理 v2.2.0/v2.2.1 旧版独立守护目录: " + studioStandalone);
                }
                catch (Exception ex)
                {
                    if (log != null) log("[!] 清理旧目录部分受限 (" + studioStandalone + "): " + ex.Message);
                }
            }

            // 3. Clean legacy native plugin (~/.gemini/config/plugins/agy-claude-style)
            string stylePlugin = GetLegacyStylePluginDir();
            if (Directory.Exists(stylePlugin) && !PathsEqual(stylePlugin, targetInstallDir))
            {
                StopProcessesInDirectory(stylePlugin, log);
                try
                {
                    Directory.Delete(stylePlugin, true);
                    result.CleanedLegacyItems.Add("legacy-plugin:agy-claude-style");
                    if (log != null) log("已移除旧版 agy-claude-style 插件目录（plugin_data 数据已保留）");
                }
                catch (Exception ex)
                {
                    if (log != null) log("[!] 清理旧版插件目录受限: " + ex.Message);
                }
            }

            // 4. Clean legacy Startup shortcuts (never touch unrelated user items)
            string startupDir = GetStartupDir();
            for (int i = 0; i < LegacyStartupLnkNames.Length; i++)
            {
                string lnk = Path.Combine(startupDir, LegacyStartupLnkNames[i]);
                if (File.Exists(lnk))
                {
                    try
                    {
                        File.Delete(lnk);
                        result.CleanedLegacyItems.Add("legacy-startup:" + LegacyStartupLnkNames[i]);
                        if (log != null) log("已移除旧版开机自启快捷方式: " + LegacyStartupLnkNames[i]);
                    }
                    catch { }
                }
            }

            // 5. Clean legacy Claude Style Desktop / StartMenu shortcuts (NEVER touch user's Gemini.lnk!)
            string[] shortcutDirs = new string[] { GetStartMenuDir(), GetDesktopDir() };
            for (int d = 0; d < shortcutDirs.Length; d++)
            {
                if (string.IsNullOrEmpty(shortcutDirs[d])) continue;
                for (int i = 0; i < LegacyLauncherLnkNames.Length; i++)
                {
                    string lnk = Path.Combine(shortcutDirs[d], LegacyLauncherLnkNames[i]);
                    if (File.Exists(lnk))
                    {
                        try
                        {
                            File.Delete(lnk);
                            result.CleanedLegacyItems.Add("legacy-shortcut:" + LegacyLauncherLnkNames[i]);
                            if (log != null) log("已清理旧版快捷方式: " + lnk);
                        }
                        catch { }
                    }
                }
            }

            // 6. Clean legacy HKCU Uninstall\AGYClaudeStyle registry entry
            if (string.IsNullOrEmpty(GetTestSystemRoot()))
            {
                try
                {
                    using (RegistryKey existing = Registry.CurrentUser.OpenSubKey(LegacyStyleUninstallRegSubKey))
                    {
                        if (existing != null)
                        {
                            Registry.CurrentUser.DeleteSubKeyTree(LegacyStyleUninstallRegSubKey, false);
                            result.CleanedLegacyItems.Add("legacy-registry:AGYClaudeStyle");
                            if (log != null) log("已清理旧版 Claude Style 卸载注册表项");
                        }
                    }
                }
                catch { }
            }
        }

        public static bool SetHostPluginEnabled(bool enabled, bool disableLegacyStyle, Action<string> log)
        {
            string cfgPath = GetHostConfigPath();
            try
            {
                Dictionary<string, object> root;
                if (File.Exists(cfgPath))
                {
                    string raw = File.ReadAllText(cfgPath, Encoding.UTF8);
                    if (string.IsNullOrWhiteSpace(raw))
                    {
                        root = new Dictionary<string, object>(StringComparer.Ordinal);
                    }
                    else
                    {
                        root = MiniJson.ParseObject(raw);
                    }
                }
                else
                {
                    if (!enabled) return false;
                    root = new Dictionary<string, object>(StringComparer.Ordinal);
                }

                Dictionary<string, object> plugins = null;
                if (root.ContainsKey("plugins") && root["plugins"] is Dictionary<string, object>)
                {
                    plugins = (Dictionary<string, object>)root["plugins"];
                }
                else
                {
                    if (!enabled) return false;
                    plugins = new Dictionary<string, object>(StringComparer.Ordinal);
                    root["plugins"] = plugins;
                }

                Dictionary<string, object> studioEntry = null;
                if (plugins.ContainsKey("agy-claude-studio") && plugins["agy-claude-studio"] is Dictionary<string, object>)
                {
                    studioEntry = (Dictionary<string, object>)plugins["agy-claude-studio"];
                }
                else
                {
                    studioEntry = new Dictionary<string, object>(StringComparer.Ordinal);
                    plugins["agy-claude-studio"] = studioEntry;
                }
                studioEntry["enabled"] = enabled;

                if (disableLegacyStyle && plugins.ContainsKey("agy-claude-style") && plugins["agy-claude-style"] is Dictionary<string, object>)
                {
                    Dictionary<string, object> legacyEntry = (Dictionary<string, object>)plugins["agy-claude-style"];
                    legacyEntry["enabled"] = false;
                }

                string parent = Path.GetDirectoryName(cfgPath);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                string serialized = MiniJson.Stringify(root, true) + "\n";
                string tmpPath = cfgPath + ".tmp." + Process.GetCurrentProcess().Id;
                File.WriteAllText(tmpPath, serialized, new UTF8Encoding(false));
                if (File.Exists(cfgPath))
                {
                    try
                    {
                        File.Replace(tmpPath, cfgPath, null, true);
                    }
                    catch
                    {
                        File.Copy(tmpPath, cfgPath, true);
                        try { File.Delete(tmpPath); } catch { }
                    }
                }
                else
                {
                    File.Move(tmpPath, cfgPath);
                }

                if (log != null)
                {
                    log(enabled
                        ? "已在 Antigravity 宿主配置中启用原生插件 (plugins.agy-claude-studio.enabled = true)"
                        : "已在 Antigravity 宿主配置中禁用原生插件 (plugins.agy-claude-studio.enabled = false)");
                }
                return true;
            }
            catch (Exception ex)
            {
                if (log != null) log("[!] 无法自动更新宿主 config.json（已保留原文件未修改）: " + ex.Message);
                return false;
            }
        }

        public static void RegisterUninstallEntry(string installDir, string uninstallerExePath, string iconPath, string version)
        {
            if (!string.IsNullOrEmpty(GetTestSystemRoot())) return;
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallRegSubKey))
            {
                if (key == null) return;
                string displayIcon = (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath))
                    ? iconPath
                    : uninstallerExePath;
                key.SetValue("DisplayName", "Claude Studio (Antigravity 原生插件)", RegistryValueKind.String);
                key.SetValue("DisplayVersion", version ?? "2.2.3", RegistryValueKind.String);
                key.SetValue("Publisher", "Claude Studio", RegistryValueKind.String);
                key.SetValue("InstallLocation", installDir, RegistryValueKind.String);
                key.SetValue("DisplayIcon", displayIcon + ",0", RegistryValueKind.String);
                key.SetValue("UninstallString", "\"" + uninstallerExePath + "\" --uninstall --install-dir \"" + installDir + "\"", RegistryValueKind.String);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static bool IsProtectedUserScriptPath(string normalizedRelPath)
        {
            return normalizedRelPath.StartsWith("scripts\\ops\\", StringComparison.OrdinalIgnoreCase);
        }

        public static OperationResult RunInstall(InstallerOptions opts, Action<int, string> progress)
        {
            OperationResult result = new OperationResult();
            result.Mode = "install";
            string installDir = Path.GetFullPath(string.IsNullOrEmpty(opts.InstallDir) ? GetDefaultInstallDir() : opts.InstallDir).TrimEnd('\\', '/');
            result.InstallDir = installDir;

            Action<int, string> report = (pct, msg) =>
            {
                if (progress != null) progress(pct, msg);
            };

            report(6, "准备安装 Claude Studio Antigravity 原生插件...");
            AntigravityDetectResult ag = DetectAntigravityDesktop(opts.AntigravityExe);
            result.AntigravityExe = ag.ExePath;
            result.AntigravityVersion = ag.Version;
            result.AntigravityRunning = ag.IsRunning;

            if (!string.IsNullOrEmpty(ag.ExePath))
            {
                report(14, "已定位 Antigravity Desktop" + (string.IsNullOrEmpty(ag.Version) ? "" : " (" + ag.Version + ")") + ": " + ag.ExePath);
            }
            else
            {
                report(14, "[!] 未自动检测到 Antigravity.exe，将继续安装原生插件（建议稍后手动指定路径以创建启动快捷方式）");
            }

            // Safeguard 1A: Preserve or migrate user configuration BEFORE deleting any legacy directory!
            report(22, "正在检查并保护 / 迁移用户配置 (plugin_data)...");
            PreserveOrMigrateUserConfig(installDir, result, (m) => report(26, m));

            // Safeguard 1B: Targeted uninstall & cleanup of legacy 2.1.0 / 2.2.0 / 2.2.1 standalone & old plugin installs.
            if (!opts.NoKillLegacy)
            {
                report(32, "正在排查并清理旧版 2.1.0 / 2.2.0 / 2.2.1 独立守护与遗留插件...");
                CleanupLegacyInstallations(installDir, result, (m) => report(38, m));
            }
            else
            {
                report(35, "已按参数跳过旧版清理 (--no-kill-legacy)");
            }

            // Safeguard 2A: Extract complete Native Plugin payload into ~/.gemini/config/plugins/agy-claude-studio
            report(48, "正在释放完整原生插件文件至: " + installDir);
            Directory.CreateDirectory(installDir);
            string installDirWithSep = installDir + "\\";

            using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("AGY_PAYLOAD.zip"))
            {
                if (resStream == null) throw new InvalidOperationException("安装包内嵌资源 AGY_PAYLOAD.zip 缺失");
                using (ZipArchive archive = new ZipArchive(resStream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        string relPath = entry.FullName.Replace('/', '\\').TrimStart('\\');
                        string destPath = Path.GetFullPath(Path.Combine(installDir, relPath));
                        if (!destPath.StartsWith(installDirWithSep, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("检测到非法压缩包路径: " + entry.FullName);
                        }
                        if (IsProtectedUserScriptPath(relPath) && File.Exists(destPath))
                        {
                            continue;
                        }
                        string parent = Path.GetDirectoryName(destPath);
                        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);

                        using (Stream inStream = entry.Open())
                        using (FileStream outStream = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            inStream.CopyTo(outStream);
                        }
                    }
                }
            }
            report(64, "原生插件核心、3-Tab 侧边栏、0-Token 手机推送钩子与 4 项技能已部署完成");

            // Ensure plugin_data/config.json exists with defaults if user had no prior config
            string targetCfg = Path.Combine(result.PluginDataDir, "config.json");
            if (!File.Exists(targetCfg))
            {
                string exampleCfg = Path.Combine(installDir, "config.example.json");
                if (File.Exists(exampleCfg))
                {
                    try { File.Copy(exampleCfg, targetCfg, false); } catch { }
                }
            }

            // Copy uninstaller executable outside plugin dir so 1-click self-update never wipes it
            string uninstallerDir = GetUninstallerDir();
            string uninstallerExe = Path.Combine(uninstallerDir, SelfInstalledExeName);
            try
            {
                Directory.CreateDirectory(uninstallerDir);
                string selfSrc = Assembly.GetExecutingAssembly().Location;
                if (!string.IsNullOrEmpty(selfSrc) && File.Exists(selfSrc) &&
                    !PathsEqual(selfSrc, uninstallerExe))
                {
                    File.Copy(selfSrc, uninstallerExe, true);
                }
            }
            catch { }
            result.UninstallerExePath = File.Exists(uninstallerExe) ? uninstallerExe : Assembly.GetExecutingAssembly().Location;

            // Safeguard 2B: Enable native plugin in Antigravity host config.json
            report(74, "正在启用 Antigravity 原生插件配置...");
            result.HostPluginEnabled = SetHostPluginEnabled(true, true, (m) => report(76, m));

            PluginManifest manifest = PluginManifest.Load(installDir);
            Dictionary<string, object> activeCfg = CdpHelper.ReadConfig(result.PluginDataDir, manifest);
            result.ConfigSummary = string.Format(
                "语言={0} | 配色={1} | 圆环={2} | 思考滑块={3}",
                activeCfg.ContainsKey("language") ? activeCfg["language"] : "zh-CN",
                activeCfg.ContainsKey("palette") ? activeCfg["palette"] : "claude",
                activeCfg.ContainsKey("ringMode") ? activeCfg["ringMode"] : "context",
                activeCfg.ContainsKey("effortSliderStyle") ? activeCfg["effortSliderStyle"] : "claude"
            );

            // Safeguard 3: Gemini-girl icon + 100% verified direct Antigravity.exe shortcut
            string iconPath = ResolveShortcutIconPath(installDir, ag.ExePath);
            result.ShortcutIconPath = iconPath;

            if (!opts.NoAutostart)
            {
                report(84, "正在配置 Gemini × Clawd 图标启动快捷方式与卸载入口...");
                string startMenuLnk = GetStartMenuLauncherShortcutPath();
                string desktopLnk = GetDesktopLauncherShortcutPath();

                if (!string.IsNullOrEmpty(ag.ExePath) && File.Exists(ag.ExePath))
                {
                    if (CreateDirectAntigravityShortcut(startMenuLnk, ag.ExePath, iconPath))
                    {
                        result.LauncherShortcutPath = startMenuLnk;
                        report(87, "已创建开始菜单快捷方式: " + startMenuLnk);
                    }
                    if (opts.DesktopShortcut && !opts.NoDesktopShortcut)
                    {
                        if (CreateDirectAntigravityShortcut(desktopLnk, ag.ExePath, iconPath))
                        {
                            result.DesktopShortcutPath = desktopLnk;
                            report(89, "已创建桌面快捷方式（Gemini × Clawd 图标）: " + desktopLnk);
                        }
                    }
                }
                else
                {
                    // Clean up stale broken v2.2.0 watcher shortcuts so user never hits "找不到 Antigravity Desktop".
                    if (IsBrokenLegacyWatcherShortcut(startMenuLnk))
                    {
                        try { File.Delete(startMenuLnk); } catch { }
                    }
                    if (IsBrokenLegacyWatcherShortcut(desktopLnk))
                    {
                        try { File.Delete(desktopLnk); } catch { }
                    }
                    report(88, "[!] 因未找到 Antigravity.exe，已跳过创建快捷方式（不会生成失效链接）");
                }

                RegisterUninstallEntry(installDir, result.UninstallerExePath, iconPath, manifest.Version);
            }
            else
            {
                report(85, "已按参数跳过快捷方式与系统卸载入口注册");
            }

            // Probe CDP status purely for helpful user guidance (never force-kill running Antigravity)
            int? port = CdpHelper.ReadPort(opts.CdpPort);
            bool cdpReachable = false;
            if (port.HasValue)
            {
                try
                {
                    List<CdpPageInfo> probePages = CdpHelper.ListPagesAsync(port.Value).GetAwaiter().GetResult();
                    cdpReachable = (probePages != null);
                }
                catch
                {
                    cdpReachable = false;
                }
            }
            result.CdpPort = cdpReachable ? port : null;
            bool isExplicitPort = opts.CdpPort.HasValue || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AG_CDP_PORT"));
            bool effectiveAgRunning = isExplicitPort ? false : ag.IsRunning;
            result.AntigravityRunningWithoutCdp = effectiveAgRunning && !cdpReachable;

            result.Ok = true;
            if (effectiveAgRunning)
            {
                result.Headline = "原生插件安装完成！重启 Antigravity 即可生效";
                result.Detail = result.AntigravityRunningWithoutCdp
                    ? "已部署完整原生插件（含右侧 3-Tab 控制面板、手机推送与 4 项技能）并已启用。请完全退出当前 Antigravity，再双击桌面「Antigravity (Claude Studio)」启动即可。"
                    : "已部署完整原生插件并已启用，且保留全部本地配置。请重启 Antigravity 让宿主重新加载侧边栏与全部技能。";
            }
            else if (!string.IsNullOrEmpty(ag.ExePath))
            {
                result.Headline = "Claude Studio 原生插件安装成功！";
                result.Detail = "已部署完整原生插件并自动启用，已生成带 Gemini × Clawd 图标的「Antigravity (Claude Studio)」快捷方式，点击下方按钮或桌面图标即可启动！";
            }
            else
            {
                result.Headline = "原生插件已部署完成（待定位 Antigravity.exe）";
                result.Detail = "完整原生插件已安装到插件目录并启用。如 Antigravity 安装在自定义路径，请点击上方「浏览...」选择 Antigravity.exe 后再点一次安装以生成启动快捷方式。";
            }
            report(100, result.Headline);
            return result;
        }

        public static OperationResult RunUninstall(InstallerOptions opts, Action<int, string> progress)
        {
            OperationResult result = new OperationResult();
            result.Mode = "uninstall";
            string installDir = Path.GetFullPath(string.IsNullOrEmpty(opts.InstallDir) ? GetDefaultInstallDir() : opts.InstallDir).TrimEnd('\\', '/');
            result.InstallDir = installDir;
            result.PluginDataDir = GetPluginDataDir();

            Action<int, string> report = (pct, msg) =>
            {
                if (progress != null) progress(pct, msg);
            };

            report(15, "正在停止 Claude Studio 相关进程...");
            StopProcessesInDirectory(installDir, (m) => report(22, m));
            if (!opts.NoKillLegacy)
            {
                StopProcessesInDirectory(GetLegacyStudioStandaloneDir(), (m) => report(26, m));
                StopProcessesInDirectory(GetLegacyStyleStandaloneDir(), (m) => report(28, m));
            }

            report(38, "正在通过 CDP 恢复运行中的 Antigravity 原生界面...");
            int? port = CdpHelper.ReadPort(opts.CdpPort);
            result.CdpPort = port;
            string removeExpr = null;
            if (File.Exists(Path.Combine(installDir, "manifest.json")))
            {
                try { removeExpr = PluginManifest.Load(installDir).RemoveExpression; } catch { }
            }
            if (string.IsNullOrEmpty(removeExpr))
            {
                try
                {
                    using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("AGY_PAYLOAD.zip"))
                    using (ZipArchive archive = new ZipArchive(resStream, ZipArchiveMode.Read))
                    {
                        ZipArchiveEntry entry = archive.GetEntry("manifest.json");
                        if (entry != null)
                        {
                            using (StreamReader sr = new StreamReader(entry.Open(), Encoding.UTF8))
                            {
                                Dictionary<string, object> raw = MiniJson.ParseObject(sr.ReadToEnd());
                                if (raw.ContainsKey("removeExpression")) removeExpr = raw["removeExpression"] as string;
                            }
                        }
                    }
                }
                catch { }
            }

            if (port.HasValue && !string.IsNullOrEmpty(removeExpr))
            {
                try
                {
                    List<CdpPageInfo> pages = CdpHelper.ListPagesAsync(port.Value).GetAwaiter().GetResult();
                    for (int i = 0; i < pages.Count; i++)
                    {
                        try
                        {
                            using (CdpSession s = CdpSession.ConnectAsync(pages[i].WebSocketDebuggerUrl, 3000).GetAwaiter().GetResult())
                            {
                                s.EvaluateAsync(removeExpr, false).GetAwaiter().GetResult();
                                string title = CdpHelper.ShortTitle(pages[i]);
                                result.InjectedPages.Add(title);
                                report(52, "已恢复原生界面: " + title);
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }

            report(62, "正在更新 Antigravity 插件配置...");
            SetHostPluginEnabled(false, false, (m) => report(66, m));
            result.HostPluginEnabled = false;

            if (!opts.NoAutostart)
            {
                report(72, "正在移除安装器创建的快捷方式与卸载入口...");
                string startMenuLnk = GetStartMenuLauncherShortcutPath();
                string desktopLnk = GetDesktopLauncherShortcutPath();
                try { if (File.Exists(startMenuLnk)) File.Delete(startMenuLnk); } catch { }
                try { if (File.Exists(desktopLnk)) File.Delete(desktopLnk); } catch { }

                string startupDir = GetStartupDir();
                for (int i = 0; i < LegacyStartupLnkNames.Length; i++)
                {
                    string lnk = Path.Combine(startupDir, LegacyStartupLnkNames[i]);
                    try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
                }

                if (string.IsNullOrEmpty(GetTestSystemRoot()))
                {
                    try { Registry.CurrentUser.DeleteSubKeyTree(UninstallRegSubKey, false); } catch { }
                    try { Registry.CurrentUser.DeleteSubKeyTree(LegacyStyleUninstallRegSubKey, false); } catch { }
                }
            }

            report(84, "正在移除插件目录（已保留 plugin_data 用户配置）: " + installDir);
            if (Directory.Exists(installDir))
            {
                try { Directory.Delete(installDir, true); } catch { }
            }

            string uninstallerDir = GetUninstallerDir();
            string selfExe = Assembly.GetExecutingAssembly().Location;
            bool runningInsideUninstallerDir = IsExecutableInsideDir(selfExe, uninstallerDir);
            if (Directory.Exists(uninstallerDir))
            {
                if (!runningInsideUninstallerDir)
                {
                    try { Directory.Delete(uninstallerDir, true); } catch { }
                }
                else
                {
                    result.SelfDeleteScheduled = true;
                }
            }

            result.Ok = true;
            result.Headline = "已卸载 Claude Studio 原生插件";
            result.Detail = result.InjectedPages.Count > 0
                ? string.Format("已移除插件、快捷方式并立即还原了 {0} 个窗口；个人配置保留在 plugin_data 目录中。", result.InjectedPages.Count)
                : "已移除原生插件、快捷方式与卸载入口；个人配置与推送密钥已保留在 plugin_data 目录中。";
            report(100, result.Headline);
            return result;
        }

        public static void ScheduleSelfDeleteIfNeeded(string dirToDelete)
        {
            string selfExe = Assembly.GetExecutingAssembly().Location;
            if (string.IsNullOrEmpty(selfExe) || string.IsNullOrEmpty(dirToDelete)) return;
            string escapedExe = selfExe.Replace("'", "''");
            string escapedDir = dirToDelete.Replace("'", "''");
            string psScript = string.Format(
                "$e='{0}';$d='{1}';for($i=0;$i -lt 12;$i++){{Start-Sleep -Milliseconds 350;if(Test-Path -LiteralPath $e){{Remove-Item -LiteralPath $e -Force -ErrorAction SilentlyContinue}};if(Test-Path -LiteralPath $d){{Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue}};if(-not (Test-Path -LiteralPath $d)){{exit 0}}}}",
                escapedExe,
                escapedDir
            );
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(psScript));
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand " + encoded);
            psi.WorkingDirectory = Path.GetTempPath();
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            try { Process.Start(psi); } catch { }
        }
    }

    internal class InstallerForm : Form
    {
        private readonly InstallerOptions _opts;
        private readonly Label _titleLabel;
        private readonly Label _subtitleLabel;
        private readonly TextBox _agPathBox;
        private readonly Button _browseAgBtn;
        private readonly Label _legacyInfoLabel;
        private readonly CheckBox _desktopShortcutCheck;
        private readonly Label _statusHeadline;
        private readonly Label _statusDetail;
        private readonly Label _metaLabel;
        private readonly ProgressBar _progressBar;
        private readonly TextBox _logBox;
        private readonly Button _actionBtn;
        private readonly Button _uninstallBtn;
        private readonly Button _openDirBtn;
        private readonly Button _launchAgBtn;
        private readonly Button _closeBtn;

        private string _activeInstallDir;
        private string _antigravityExe;
        private bool _selfDeleteOnClose;
        private bool _busy;

        public InstallerForm(InstallerOptions opts)
        {
            _opts = opts;
            _activeInstallDir = Path.GetFullPath(string.IsNullOrEmpty(opts.InstallDir) ? InstallerCore.GetDefaultInstallDir() : opts.InstallDir).TrimEnd('\\', '/');
            bool isInstalled = InstallerCore.IsNativePluginInstalled(_activeInstallDir);
            LegacyDetectSummary legacy = InstallerCore.DetectLegacyInstalls(_activeInstallDir);

            Text = "Claude Studio 原生插件安装器";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);
            ClientSize = new Size(640, 588);
            BackColor = Color.FromArgb(248, 246, 243);
            try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 76;
            header.BackColor = Color.FromArgb(26, 25, 24);
            header.Padding = new Padding(20, 12, 20, 10);

            _titleLabel = new Label();
            _titleLabel.Text = "Claude Studio · Antigravity 原生插件一键安装器";
            _titleLabel.ForeColor = Color.FromArgb(250, 248, 245);
            _titleLabel.Font = new Font("Microsoft YaHei UI", 13f, FontStyle.Bold);
            _titleLabel.AutoSize = true;
            _titleLabel.Location = new Point(20, 12);

            _subtitleLabel = new Label();
            _subtitleLabel.Text = "完整 3-Tab 控制面板 · 0-Token 手机推送 · 自动清理旧版独立守护并保留配置";
            _subtitleLabel.ForeColor = Color.FromArgb(217, 119, 87);
            _subtitleLabel.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular);
            _subtitleLabel.AutoSize = true;
            _subtitleLabel.Location = new Point(21, 44);

            header.Controls.Add(_titleLabel);
            header.Controls.Add(_subtitleLabel);
            Controls.Add(header);

            Panel envPanel = new Panel();
            envPanel.Location = new Point(20, 88);
            envPanel.Size = new Size(600, 134);
            envPanel.BackColor = Color.White;
            envPanel.BorderStyle = BorderStyle.FixedSingle;

            Label agLabel = new Label();
            agLabel.Text = "Antigravity.exe 路径（用于生成带 CDP 参数的 Gemini × Clawd 启动图标）";
            agLabel.ForeColor = Color.FromArgb(28, 25, 23);
            agLabel.Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Bold);
            agLabel.Location = new Point(14, 10);
            agLabel.Size = new Size(572, 20);

            _agPathBox = new TextBox();
            _agPathBox.Location = new Point(14, 34);
            _agPathBox.Size = new Size(482, 26);
            _agPathBox.ReadOnly = true;
            _agPathBox.BackColor = Color.FromArgb(250, 249, 247);
            _agPathBox.Text = "正在自动定位本机 Antigravity Desktop...";

            _browseAgBtn = new Button();
            _browseAgBtn.Text = "浏览...";
            _browseAgBtn.Location = new Point(504, 33);
            _browseAgBtn.Size = new Size(80, 27);
            _browseAgBtn.FlatStyle = FlatStyle.System;
            _browseAgBtn.Click += (s, e) => BrowseForAntigravityExe();

            _legacyInfoLabel = new Label();
            _legacyInfoLabel.Location = new Point(14, 68);
            _legacyInfoLabel.Size = new Size(572, 28);
            _legacyInfoLabel.Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular);
            if (legacy.Items.Count > 0)
            {
                _legacyInfoLabel.ForeColor = Color.FromArgb(180, 83, 9);
                _legacyInfoLabel.Text = "旧版兜底清理: 检测到 " + string.Join(" / ", legacy.Items.ToArray()) + "，安装时将自动卸载并迁移配置";
            }
            else
            {
                _legacyInfoLabel.ForeColor = Color.FromArgb(21, 128, 61);
                _legacyInfoLabel.Text = "环境干净: 未检测到旧版独立守护冲突，将直接部署完整原生插件并保留 plugin_data 用户配置";
            }

            _desktopShortcutCheck = new CheckBox();
            _desktopShortcutCheck.Text = "在桌面创建「Antigravity (Claude Studio)」启动快捷方式（Gemini × Clawd 图标）";
            _desktopShortcutCheck.ForeColor = Color.FromArgb(41, 37, 36);
            _desktopShortcutCheck.Location = new Point(14, 100);
            _desktopShortcutCheck.Size = new Size(572, 22);
            _desktopShortcutCheck.Checked = opts.DesktopShortcut && !opts.NoDesktopShortcut;

            envPanel.Controls.Add(agLabel);
            envPanel.Controls.Add(_agPathBox);
            envPanel.Controls.Add(_browseAgBtn);
            envPanel.Controls.Add(_legacyInfoLabel);
            envPanel.Controls.Add(_desktopShortcutCheck);
            Controls.Add(envPanel);

            Panel card = new Panel();
            card.Location = new Point(20, 232);
            card.Size = new Size(600, 110);
            card.BackColor = Color.White;
            card.BorderStyle = BorderStyle.FixedSingle;

            _statusHeadline = new Label();
            if (opts.Uninstall)
            {
                _statusHeadline.Text = "准备卸载 Claude Studio 原生插件...";
            }
            else if (isInstalled)
            {
                _statusHeadline.Text = "已检测到 Claude Studio 原生插件，可一键原地升级修复";
            }
            else
            {
                _statusHeadline.Text = "点击「一键安装原生插件」开始部署";
            }
            _statusHeadline.ForeColor = Color.FromArgb(28, 25, 23);
            _statusHeadline.Font = new Font("Microsoft YaHei UI", 10.8f, FontStyle.Bold);
            _statusHeadline.Location = new Point(14, 10);
            _statusHeadline.Size = new Size(572, 24);

            _statusDetail = new Label();
            _statusDetail.Text = opts.Uninstall
                ? "确认后将移除原生插件、快捷方式与卸载入口，同时完整保留您的个人配置与推送密钥。"
                : "安装至 Antigravity 官方插件目录，开启右侧 3-Tab 控制面板、0-Token 手机推送与一键在线更新，零独立后台进程。";
            _statusDetail.ForeColor = Color.FromArgb(87, 83, 78);
            _statusDetail.Location = new Point(14, 38);
            _statusDetail.Size = new Size(572, 40);

            _metaLabel = new Label();
            _metaLabel.Text = "插件目录: " + _activeInstallDir;
            _metaLabel.ForeColor = Color.FromArgb(120, 113, 108);
            _metaLabel.Font = new Font("Microsoft YaHei UI", 8.2f, FontStyle.Regular);
            _metaLabel.Location = new Point(14, 82);
            _metaLabel.Size = new Size(572, 20);

            card.Controls.Add(_statusHeadline);
            card.Controls.Add(_statusDetail);
            card.Controls.Add(_metaLabel);
            Controls.Add(card);

            _progressBar = new ProgressBar();
            _progressBar.Location = new Point(20, 352);
            _progressBar.Size = new Size(600, 14);
            _progressBar.Minimum = 0;
            _progressBar.Maximum = 100;
            _progressBar.Value = 0;
            Controls.Add(_progressBar);

            _logBox = new TextBox();
            _logBox.Location = new Point(20, 376);
            _logBox.Size = new Size(600, 142);
            _logBox.Multiline = true;
            _logBox.ReadOnly = true;
            _logBox.ScrollBars = ScrollBars.Vertical;
            _logBox.BackColor = Color.FromArgb(252, 251, 249);
            _logBox.ForeColor = Color.FromArgb(41, 37, 36);
            _logBox.Font = new Font("Consolas", 8.8f, FontStyle.Regular);
            Controls.Add(_logBox);

            _actionBtn = new Button();
            _actionBtn.Text = isInstalled ? "一键升级 / 修复" : "一键安装原生插件";
            _actionBtn.Location = new Point(20, 532);
            _actionBtn.Size = new Size(146, 36);
            _actionBtn.Enabled = !opts.Uninstall;
            _actionBtn.FlatStyle = FlatStyle.System;
            _actionBtn.Click += async (s, e) =>
            {
                SyncOptionsFromUi();
                await ExecuteInstallAsync();
            };

            _uninstallBtn = new Button();
            _uninstallBtn.Text = "卸载插件";
            _uninstallBtn.Location = new Point(174, 532);
            _uninstallBtn.Size = new Size(92, 36);
            _uninstallBtn.Enabled = isInstalled && !opts.Uninstall;
            _uninstallBtn.FlatStyle = FlatStyle.System;
            _uninstallBtn.Click += async (s, e) => await HandleUninstallClickAsync();

            _openDirBtn = new Button();
            _openDirBtn.Text = "打开插件目录";
            _openDirBtn.Location = new Point(274, 532);
            _openDirBtn.Size = new Size(106, 36);
            _openDirBtn.Enabled = Directory.Exists(_activeInstallDir);
            _openDirBtn.FlatStyle = FlatStyle.System;
            _openDirBtn.Click += (s, e) =>
            {
                try
                {
                    if (Directory.Exists(_activeInstallDir)) Process.Start("explorer.exe", _activeInstallDir);
                }
                catch { }
            };

            _launchAgBtn = new Button();
            _launchAgBtn.Text = "启动 Antigravity";
            _launchAgBtn.Location = new Point(388, 532);
            _launchAgBtn.Size = new Size(134, 36);
            _launchAgBtn.Visible = false;
            _launchAgBtn.FlatStyle = FlatStyle.System;
            _launchAgBtn.Click += (s, e) => LaunchAntigravityDirect();

            _closeBtn = new Button();
            _closeBtn.Text = "关闭";
            _closeBtn.Location = new Point(530, 532);
            _closeBtn.Size = new Size(90, 36);
            _closeBtn.Enabled = true;
            _closeBtn.FlatStyle = FlatStyle.System;
            _closeBtn.Click += (s, e) => Close();

            Controls.Add(_actionBtn);
            Controls.Add(_uninstallBtn);
            Controls.Add(_openDirBtn);
            Controls.Add(_launchAgBtn);
            Controls.Add(_closeBtn);

            Shown += async (s, e) => await StartInitialActionAsync();
            FormClosing += (s, e) =>
            {
                if (_busy)
                {
                    e.Cancel = true;
                    return;
                }
                if (_selfDeleteOnClose)
                {
                    InstallerCore.ScheduleSelfDeleteIfNeeded(InstallerCore.GetUninstallerDir());
                }
            };
        }

        private void BrowseForAntigravityExe()
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "选择本机 Antigravity.exe";
                dlg.Filter = "Antigravity (Antigravity.exe)|Antigravity.exe|可执行文件 (*.exe)|*.exe";
                dlg.CheckFileExists = true;
                if (!string.IsNullOrEmpty(_antigravityExe) && File.Exists(_antigravityExe))
                {
                    dlg.InitialDirectory = Path.GetDirectoryName(_antigravityExe);
                    dlg.FileName = Path.GetFileName(_antigravityExe);
                }
                if (dlg.ShowDialog(this) == DialogResult.OK && File.Exists(dlg.FileName))
                {
                    _antigravityExe = dlg.FileName;
                    _opts.AntigravityExe = dlg.FileName;
                    _agPathBox.Text = dlg.FileName;
                    _agPathBox.ForeColor = Color.FromArgb(28, 25, 23);
                    AppendLog("[✓] 已手动指定 Antigravity.exe: " + dlg.FileName);
                }
            }
        }

        private void SyncOptionsFromUi()
        {
            _opts.DesktopShortcut = _desktopShortcutCheck.Checked;
            _opts.NoDesktopShortcut = !_desktopShortcutCheck.Checked;
            if (!string.IsNullOrEmpty(_antigravityExe) && File.Exists(_antigravityExe))
            {
                _opts.AntigravityExe = _antigravityExe;
            }
        }

        private void LaunchAntigravityDirect()
        {
            if (string.IsNullOrEmpty(_antigravityExe) || !File.Exists(_antigravityExe))
            {
                AppendLog("[!] 未找到 Antigravity.exe，请先点击「浏览...」指定路径");
                return;
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = _antigravityExe;
                psi.Arguments = "--remote-debugging-port=0";
                psi.WorkingDirectory = Path.GetDirectoryName(_antigravityExe) ?? "";
                psi.UseShellExecute = true;
                Process.Start(psi);
                _statusHeadline.Text = "已启动 Antigravity Desktop (--remote-debugging-port=0)";
                _statusHeadline.ForeColor = Color.FromArgb(21, 128, 61);
                AppendLog("[✓] 已直接拉起: \"" + _antigravityExe + "\" --remote-debugging-port=0");
            }
            catch (Exception ex)
            {
                AppendLog("[!] 启动 Antigravity 失败: " + ex.Message);
            }
        }

        private void AppendLog(string msg)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action<string>(AppendLog), msg); } catch { }
                return;
            }
            _logBox.AppendText(string.Format("[{0}] {1}\r\n", DateTime.Now.ToString("HH:mm:ss"), msg));
        }

        private void UpdateProgress(int pct, string msg)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action<int, string>(UpdateProgress), pct, msg); } catch { }
                return;
            }
            _progressBar.Value = Math.Max(0, Math.Min(100, pct));
            AppendLog(msg);
        }

        private async Task StartInitialActionAsync()
        {
            if (_opts.Uninstall)
            {
                DialogResult dr = MessageBox.Show(
                    this,
                    "确认要卸载 Claude Studio 原生插件并恢复 Antigravity 原生界面吗？（个人配置会保留在 plugin_data 中）",
                    "卸载确认",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (dr != DialogResult.Yes)
                {
                    Close();
                    return;
                }
                await ExecuteUninstallAsync();
                return;
            }

            try
            {
                AntigravityDetectResult ag = await Task.Run(() => InstallerCore.DetectAntigravityDesktop(_opts.AntigravityExe));
                if (!_busy)
                {
                    _antigravityExe = ag.ExePath;
                    if (!string.IsNullOrEmpty(ag.ExePath))
                    {
                        _agPathBox.Text = ag.ExePath;
                        _agPathBox.ForeColor = Color.FromArgb(28, 25, 23);
                        AppendLog("[✓] 自动识别 Antigravity Desktop: " + ag.ExePath + (string.IsNullOrEmpty(ag.Version) ? "" : " (v" + ag.Version + ")"));
                    }
                    else
                    {
                        _agPathBox.Text = "未自动检测到 Antigravity.exe（请点击右侧「浏览...」手动选择）";
                        _agPathBox.ForeColor = Color.FromArgb(180, 83, 9);
                        AppendLog("[!] 未自动检测到 Antigravity.exe，如安装在自定义目录请点击「浏览...」选择");
                    }
                    _launchAgBtn.Visible = InstallerCore.IsNativePluginInstalled(_activeInstallDir) && !string.IsNullOrEmpty(_antigravityExe);
                    _launchAgBtn.Enabled = _launchAgBtn.Visible;
                }
            }
            catch { }
        }

        private async Task ExecuteInstallAsync()
        {
            _busy = true;
            SetControlsEnabled(false);
            try
            {
                OperationResult res = await Task.Run(() => InstallerCore.RunInstall(_opts, UpdateProgress));
                _activeInstallDir = res.InstallDir;
                _antigravityExe = res.AntigravityExe;
                if (!string.IsNullOrEmpty(_antigravityExe))
                {
                    _agPathBox.Text = _antigravityExe;
                    _agPathBox.ForeColor = Color.FromArgb(28, 25, 23);
                }
                _statusHeadline.Text = res.Headline;
                _statusHeadline.ForeColor = res.AntigravityRunning ? Color.FromArgb(180, 83, 9) : Color.FromArgb(21, 128, 61);
                _statusDetail.Text = res.Detail;
                _metaLabel.Text = "配置: " + res.ConfigSummary;
                _legacyInfoLabel.ForeColor = Color.FromArgb(21, 128, 61);
                _legacyInfoLabel.Text = res.CleanedLegacyItems.Count > 0
                    ? "已完成旧版清理 (" + res.CleanedLegacyItems.Count + " 项) 并保留全部用户配置"
                    : "原生插件已部署并启用，全部用户配置安全保留";
                _actionBtn.Text = "重新安装 / 更新";
                _openDirBtn.Enabled = Directory.Exists(_activeInstallDir);
                _uninstallBtn.Enabled = true;
                _launchAgBtn.Visible = !string.IsNullOrEmpty(_antigravityExe) && File.Exists(_antigravityExe);
                _launchAgBtn.Enabled = _launchAgBtn.Visible;
                _closeBtn.Text = "完成并关闭";
            }
            catch (Exception ex)
            {
                _statusHeadline.Text = "安装失败";
                _statusHeadline.ForeColor = Color.FromArgb(185, 28, 28);
                _statusDetail.Text = ex.Message;
                AppendLog("[✗] 错误: " + ex);
            }
            finally
            {
                _busy = false;
                _browseAgBtn.Enabled = true;
                _desktopShortcutCheck.Enabled = true;
                _actionBtn.Enabled = true;
                _closeBtn.Enabled = true;
            }
        }

        private async Task HandleUninstallClickAsync()
        {
            DialogResult dr = MessageBox.Show(
                this,
                "确认卸载 Claude Studio 原生插件并恢复 Antigravity 原生界面？（您的个人配置与推送密钥将保留在 plugin_data 目录中）",
                "卸载插件",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );
            if (dr != DialogResult.Yes) return;
            await ExecuteUninstallAsync();
        }

        private async Task ExecuteUninstallAsync()
        {
            _busy = true;
            SetControlsEnabled(false);
            try
            {
                OperationResult res = await Task.Run(() => InstallerCore.RunUninstall(_opts, UpdateProgress));
                _selfDeleteOnClose = res.SelfDeleteScheduled;
                _statusHeadline.Text = res.Headline;
                _statusHeadline.ForeColor = Color.FromArgb(3, 105, 161);
                _statusDetail.Text = res.Detail;
                _metaLabel.Text = "已清理插件目录: " + res.InstallDir;
                _actionBtn.Text = "一键安装原生插件";
                _openDirBtn.Enabled = false;
                _uninstallBtn.Enabled = false;
                _launchAgBtn.Visible = false;
            }
            catch (Exception ex)
            {
                _statusHeadline.Text = "卸载失败";
                _statusHeadline.ForeColor = Color.FromArgb(185, 28, 28);
                _statusDetail.Text = ex.Message;
                AppendLog("[✗] 错误: " + ex);
            }
            finally
            {
                _busy = false;
                _browseAgBtn.Enabled = true;
                _desktopShortcutCheck.Enabled = true;
                _actionBtn.Enabled = true;
                _closeBtn.Enabled = true;
            }
        }

        private void SetControlsEnabled(bool enabled)
        {
            _browseAgBtn.Enabled = enabled;
            _desktopShortcutCheck.Enabled = enabled;
            _actionBtn.Enabled = enabled;
            _uninstallBtn.Enabled = enabled;
            _openDirBtn.Enabled = enabled;
            _launchAgBtn.Enabled = enabled;
            _closeBtn.Enabled = enabled;
        }
    }

    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }

            InstallerOptions opts = ParseArgs(args);

            if (opts.StatusOnly)
            {
                string dir = Path.GetFullPath(string.IsNullOrEmpty(opts.InstallDir) ? InstallerCore.GetDefaultInstallDir() : opts.InstallDir).TrimEnd('\\', '/');
                AntigravityDetectResult ag = InstallerCore.DetectAntigravityDesktop(opts.AntigravityExe);
                LegacyDetectSummary legacy = InstallerCore.DetectLegacyInstalls(dir);
                int? port = CdpHelper.ReadPort(opts.CdpPort);
                Dictionary<string, object> st = new Dictionary<string, object>(StringComparer.Ordinal);
                st["installed"] = InstallerCore.IsNativePluginInstalled(dir);
                st["installType"] = "native-plugin";
                st["installDir"] = dir;
                st["pluginDataDir"] = InstallerCore.GetPluginDataDir();
                st["startMenuShortcut"] = File.Exists(InstallerCore.GetStartMenuLauncherShortcutPath());
                st["desktopShortcut"] = File.Exists(InstallerCore.GetDesktopLauncherShortcutPath());
                st["antigravityExe"] = ag.ExePath;
                st["antigravityVersion"] = ag.Version;
                st["antigravityRunning"] = ag.IsRunning;
                st["cdpPort"] = port.HasValue ? (object)port.Value : null;
                st["legacyInstalls"] = legacy.Items;
                string json = MiniJson.Stringify(st, true);
                if (!string.IsNullOrEmpty(opts.OutFile)) File.WriteAllText(opts.OutFile, json, new UTF8Encoding(false));
                else Console.WriteLine(json);
                return 0;
            }

            if (opts.Silent)
            {
                try
                {
                    OperationResult res = opts.Uninstall
                        ? InstallerCore.RunUninstall(opts, null)
                        : InstallerCore.RunInstall(opts, null);
                    WriteOutFile(opts.OutFile, res);
                    if (opts.Popup)
                    {
                        MessageBox.Show(res.Detail, res.Headline, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    if (res.SelfDeleteScheduled)
                    {
                        InstallerCore.ScheduleSelfDeleteIfNeeded(InstallerCore.GetUninstallerDir());
                    }
                    return res.Ok ? 0 : 1;
                }
                catch (Exception ex)
                {
                    if (!string.IsNullOrEmpty(opts.OutFile))
                    {
                        Dictionary<string, object> err = new Dictionary<string, object>(StringComparer.Ordinal);
                        err["ok"] = false;
                        err["error"] = ex.Message;
                        File.WriteAllText(opts.OutFile, MiniJson.Stringify(err, true), new UTF8Encoding(false));
                    }
                    if (opts.Popup)
                    {
                        MessageBox.Show(ex.Message, "Claude Studio 操作失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm(opts));
            return 0;
        }

        private static InstallerOptions ParseArgs(string[] args)
        {
            InstallerOptions opts = new InstallerOptions();
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--uninstall") opts.Uninstall = true;
                else if (a == "--silent" || a == "/S" || a == "-s") opts.Silent = true;
                else if (a == "--popup") opts.Popup = true;
                else if (a == "--status") opts.StatusOnly = true;
                else if (a == "--no-autostart") opts.NoAutostart = true;
                else if (a == "--no-kill-legacy") opts.NoKillLegacy = true;
                else if (a == "--desktop-shortcut")
                {
                    opts.DesktopShortcut = true;
                    opts.NoDesktopShortcut = false;
                }
                else if (a == "--no-desktop-shortcut")
                {
                    opts.DesktopShortcut = false;
                    opts.NoDesktopShortcut = true;
                }
                else if (a == "--install-dir" && i + 1 < args.Length) opts.InstallDir = args[++i];
                else if (a == "--antigravity-exe" && i + 1 < args.Length) opts.AntigravityExe = args[++i];
                else if (a.StartsWith("--antigravity-exe=", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AntigravityExe = a.Substring("--antigravity-exe=".Length);
                }
                else if (a == "--cdp-port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[++i], out p) && p > 0) opts.CdpPort = p;
                }
                else if (a == "--out" && i + 1 < args.Length) opts.OutFile = args[++i];
            }
            return opts;
        }

        private static void WriteOutFile(string outFile, OperationResult res)
        {
            if (string.IsNullOrEmpty(outFile)) return;
            Dictionary<string, object> d = new Dictionary<string, object>(StringComparer.Ordinal);
            d["ok"] = res.Ok;
            d["mode"] = res.Mode;
            d["installType"] = res.InstallType;
            d["launcherShortcut"] = res.LauncherShortcutPath;
            d["desktopShortcut"] = res.DesktopShortcutPath;
            d["shortcutIcon"] = res.ShortcutIconPath;
            d["headline"] = res.Headline;
            d["detail"] = res.Detail;
            d["installDir"] = res.InstallDir;
            d["pluginDataDir"] = res.PluginDataDir;
            d["uninstallerExe"] = res.UninstallerExePath;
            d["antigravityExe"] = res.AntigravityExe;
            d["antigravityVersion"] = res.AntigravityVersion;
            d["antigravityRunning"] = res.AntigravityRunning;
            d["antigravityRunningWithoutCdp"] = res.AntigravityRunningWithoutCdp;
            d["hostPluginEnabled"] = res.HostPluginEnabled;
            d["cdpPort"] = res.CdpPort.HasValue ? (object)res.CdpPort.Value : null;
            d["injectedPages"] = res.InjectedPages;
            d["cleanedLegacyItems"] = res.CleanedLegacyItems;
            d["preservedExistingConfig"] = res.PreservedExistingConfig;
            d["migratedConfigFrom"] = res.MigratedConfigFrom;
            d["selfDeleteScheduled"] = res.SelfDeleteScheduled;
            File.WriteAllText(outFile, MiniJson.Stringify(d, true), new UTF8Encoding(false));
        }
    }
}
