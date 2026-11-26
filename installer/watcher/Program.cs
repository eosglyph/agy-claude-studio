using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AgyClaudeStudio.Watcher
{
    internal class AttachedEntry
    {
        public CdpSession Session;
        public string BootstrapScriptId;
        public string ConfigScriptId;
        public string Title;
        public readonly SemaphoreSlim ScriptLock = new SemaphoreSlim(1, 1);
        public volatile bool Retired;
    }

    internal static class Program
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

        private static readonly object LogLock = new object();
        private static string _baseDir;
        private static string _logFile;
        private static string _pidFile;
        private static bool _isWatch;
        private static int _pollMs = 2000;
        private static readonly object HostConfigLock = new object();
        private static bool _hostEnabled;

        private static bool HostEnabled()
        {
            lock (HostConfigLock)
            {
                try
                {
                    string path = Environment.GetEnvironmentVariable("AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG");
                    if (string.IsNullOrWhiteSpace(path)) path = Environment.GetEnvironmentVariable("AGY_CLAUDE_STYLE_ANTIGRAVITY_CONFIG");
                    if (string.IsNullOrWhiteSpace(path)) path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini", "config", "config.json");
                    var plugins = Child(MiniJson.ParseObject(File.ReadAllText(path)), "plugins");
                    _hostEnabled = GetConfigBool(Child(plugins, "agy-claude-studio"), "enabled", true);
                }
                catch (FileNotFoundException) { _hostEnabled = true; }
                catch (DirectoryNotFoundException) { _hostEnabled = true; }
                catch (Exception) { /* Unreadable or invalid config: keep the last decision. */ }
                return _hostEnabled;
            }
        }

        private static async Task RetireAsync(AttachedEntry entry, string removeExpr)
        {
            entry.Retired = true;
            await entry.ScriptLock.WaitAsync().ConfigureAwait(false);
            try
            {
                foreach (var id in new[] { entry.ConfigScriptId, entry.BootstrapScriptId })
                {
                    if (id == null) continue;
                    try { await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", new Dictionary<string, object> { { "identifier", id } }, 5000).ConfigureAwait(false); } catch { }
                }
                try { await entry.Session.EvaluateAsync(removeExpr, false).ConfigureAwait(false); } catch { }
            }
            finally { entry.Session.Close(); entry.ScriptLock.Release(); }
        }

        [STAThread]
        private static int Main(string[] args)
        {
            string mode = "watch";
            string customDir = null;
            int? overridePort = null;
            string outFile = null;
            bool exitOnHostCloseFlag = false;
            bool relaunchFlag = false;
            bool replaceFlag = false;
            int? parentPid = null;
            int startupGraceSeconds = CdpHelper.DefaultStartupGraceSeconds;

            string envPpid = Environment.GetEnvironmentVariable("AG_PARENT_PID");
            if (!string.IsNullOrEmpty(envPpid))
            {
                int parsedPpid;
                if (int.TryParse(envPpid.Trim(), out parsedPpid) && parsedPpid > 0) parentPid = parsedPpid;
            }

            string envGrace = Environment.GetEnvironmentVariable("AG_STARTUP_GRACE_SEC");
            if (!string.IsNullOrEmpty(envGrace))
            {
                int parsedGrace;
                if (int.TryParse(envGrace.Trim(), out parsedGrace) && parsedGrace > 0) startupGraceSeconds = parsedGrace;
            }

            string envPoll = Environment.GetEnvironmentVariable("AG_WATCH_POLL_MS");
            if (!string.IsNullOrEmpty(envPoll))
            {
                int parsedPoll;
                if (int.TryParse(envPoll.Trim(), out parsedPoll) && parsedPoll > 0)
                {
                    _pollMs = Math.Max(100, Math.Min(10000, parsedPoll));
                }
            }

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--watch") mode = "watch";
                else if (a == "--once") mode = "once";
                else if (a == "--remove") mode = "remove";
                else if (a == "--launch") mode = "launch";
                else if (a == "--relaunch") relaunchFlag = true;
                else if (a == "--replace") replaceFlag = true;
                else if (a == "--exit-on-host-close") exitOnHostCloseFlag = true;
                else if (a == "--parent-pid" && i + 1 < args.Length)
                {
                    int pp;
                    if (int.TryParse(args[++i], out pp) && pp > 0) parentPid = pp;
                }
                else if (a.StartsWith("--parent-pid=", StringComparison.Ordinal))
                {
                    int pp;
                    if (int.TryParse(a.Substring("--parent-pid=".Length), out pp) && pp > 0) parentPid = pp;
                }
                else if (a == "--dir" && i + 1 < args.Length) customDir = args[++i];
                else if (a.StartsWith("--dir=", StringComparison.Ordinal)) customDir = a.Substring("--dir=".Length);
                else if (a == "--cdp-port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[++i], out p) && p > 0) overridePort = p;
                }
                else if (a.StartsWith("--cdp-port=", StringComparison.Ordinal))
                {
                    int p;
                    if (int.TryParse(a.Substring("--cdp-port=".Length), out p) && p > 0) overridePort = p;
                }
                else if (a == "--out" && i + 1 < args.Length) outFile = args[++i];
                else if (a == "--startup-grace" && i + 1 < args.Length)
                {
                    int sg;
                    if (int.TryParse(args[++i], out sg) && sg > 0) startupGraceSeconds = sg;
                }
                else if (a.StartsWith("--startup-grace=", StringComparison.Ordinal))
                {
                    int sg;
                    if (int.TryParse(a.Substring("--startup-grace=".Length), out sg) && sg > 0) startupGraceSeconds = sg;
                }
            }

            _baseDir = Path.GetFullPath(string.IsNullOrEmpty(customDir) ? AppDomain.CurrentDomain.BaseDirectory : customDir).TrimEnd('\\', '/');
            _logFile = Path.Combine(_baseDir, "watch.log");
            _pidFile = Path.Combine(_baseDir, ".watch.pid");
            _isWatch = (mode == "watch" || mode == "launch");

            try
            {
                if (mode == "once")
                {
                    return RunOnceAsync(overridePort, outFile).GetAwaiter().GetResult();
                }
                if (mode == "remove")
                {
                    return RunRemoveAsync(overridePort, outFile).GetAwaiter().GetResult();
                }
                if (mode == "launch")
                {
                    return RunLaunchAndWatchAsync(overridePort, relaunchFlag, replaceFlag, parentPid, startupGraceSeconds, outFile).GetAwaiter().GetResult();
                }
                return RunWatchAsync(overridePort, exitOnHostCloseFlag, parentPid, exitOnHostCloseFlag, startupGraceSeconds, replaceFlag, false).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Log("[!] Fatal error: " + ex.Message);
                WriteResult(outFile, false, ex.Message, null);
                if (mode == "launch")
                {
                    ShowLaunchErrorUiIfAllowed(outFile, ex.Message);
                }
                return 1;
            }
        }

        private static void ShowLaunchErrorUiIfAllowed(string outFile, string message)
        {
            if (!string.IsNullOrEmpty(outFile)) return;
            if (string.Equals(Environment.GetEnvironmentVariable("AGY_CS_NO_UI"), "1", StringComparison.Ordinal)) return;
            try
            {
                MessageBoxW(IntPtr.Zero, message ?? "启动失败", "Claude Studio", 0x00000010u);
            }
            catch { }
        }

        private static void Log(string line)
        {
            if (!_isWatch) return;
            lock (LogLock)
            {
                try
                {
                    FileInfo fi = new FileInfo(_logFile);
                    if (fi.Exists && fi.Length > 1024 * 1024)
                    {
                        File.WriteAllText(_logFile, "", new UTF8Encoding(false));
                    }
                    string entry = string.Format("[{0}] {1}\n", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), line);
                    byte[] bytes = new UTF8Encoding(false).GetBytes(entry);
                    using (FileStream fs = new FileStream(_logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                    {
                        fs.Write(bytes, 0, bytes.Length);
                    }
                }
                catch { }
            }
        }



        private static void WriteResult(string outFile, bool ok, string message, List<string> pages)
        {
            if (string.IsNullOrEmpty(outFile)) return;
            try
            {
                Dictionary<string, object> res = new Dictionary<string, object>(StringComparer.Ordinal);
                res["ok"] = ok;
                res["message"] = message ?? "";
                if (pages != null) res["pages"] = pages;
                File.WriteAllText(outFile, MiniJson.Stringify(res, true), new UTF8Encoding(false));
            }
            catch { }
        }

        public static string GetDirHash(string dir)
        {
            return CdpHelper.ComputeHash(Path.GetFullPath(dir).TrimEnd('\\', '/').ToLowerInvariant());
        }

        private static int? ReadPidFile()
        {
            try
            {
                if (!File.Exists(_pidFile)) return null;
                int pid;
                if (int.TryParse(File.ReadAllText(_pidFile, Encoding.UTF8).Trim(), out pid) && pid > 0) return pid;
            }
            catch { }
            return null;
        }

        private static void ReleasePidFile(int selfPid)
        {
            try
            {
                int? current = ReadPidFile();
                if (current.HasValue && current.Value == selfPid)
                {
                    File.Delete(_pidFile);
                }
            }
            catch { }
        }

        private static async Task<int> RunOnceAsync(int? overridePort, string outFile)
        {
            if (!HostEnabled()) { WriteResult(outFile, true, "plugin disabled", new List<string>()); return 0; }
            PluginManifest manifest = PluginManifest.Load(_baseDir);
            int? port = CdpHelper.ReadPort(overridePort);
            if (!port.HasValue)
            {
                bool running = CdpHelper.GetAntigravityProcessIds().Count > 0;
                WriteResult(outFile, false, CdpHelper.CdpUnavailableMessage(running, null), null);
                return 1;
            }

            List<CdpPageInfo> pages;
            try
            {
                pages = await CdpHelper.ListPagesAsync(port.Value).ConfigureAwait(false);
            }
            catch
            {
                bool running = CdpHelper.GetAntigravityProcessIds().Count > 0;
                WriteResult(outFile, false, CdpHelper.CdpUnavailableMessage(running, port), null);
                return 1;
            }
            if (pages.Count == 0)
            {
                WriteResult(outFile, false, "未找到 Antigravity 窗口页面", null);
                return 1;
            }

            string expr = CdpHelper.BuildInjectExpression(_baseDir, manifest);
            List<string> injectedTitles = new List<string>();
            for (int i = 0; i < pages.Count; i++)
            {
                CdpPageInfo page = pages[i];
                using (CdpSession session = await CdpSession.ConnectAsync(page.WebSocketDebuggerUrl, 4000).ConfigureAwait(false))
                {
                    if (!HostEnabled()) break;
                    await session.EvaluateAsync(expr, false).ConfigureAwait(false);
                    injectedTitles.Add(CdpHelper.ShortTitle(page));
                }
            }
            WriteResult(outFile, true, "injected " + injectedTitles.Count + " page(s)", injectedTitles);
            return 0;
        }

        private static async Task<int> RunRemoveAsync(int? overridePort, string outFile)
        {
            PluginManifest manifest = null;
            try
            {
                if (File.Exists(Path.Combine(_baseDir, "manifest.json")))
                {
                    manifest = PluginManifest.Load(_baseDir);
                }
            }
            catch { }
            StopRunningWatcherInDir(_baseDir);

            int? port = CdpHelper.ReadPort(overridePort);
            List<string> cleaned = new List<string>();
            string removeExpr = manifest != null ? manifest.RemoveExpression : null;
            if (port.HasValue && !string.IsNullOrEmpty(removeExpr))
            {
                try
                {
                    List<CdpPageInfo> pages = await CdpHelper.ListPagesAsync(port.Value).ConfigureAwait(false);
                    for (int i = 0; i < pages.Count; i++)
                    {
                        CdpPageInfo page = pages[i];
                        try
                        {
                            using (CdpSession session = await CdpSession.ConnectAsync(page.WebSocketDebuggerUrl, 3000).ConfigureAwait(false))
                            {
                                await session.EvaluateAsync(removeExpr, false).ConfigureAwait(false);
                                cleaned.Add(CdpHelper.ShortTitle(page));
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
            WriteResult(outFile, true, "removed from " + cleaned.Count + " page(s)", cleaned);
            return 0;
        }

        private static void StopRunningWatcherInDir(string dir)
        {
            string pidFile = Path.Combine(dir, ".watch.pid");
            int? pid = null;
            try
            {
                if (File.Exists(pidFile))
                {
                    int p;
                    if (int.TryParse(File.ReadAllText(pidFile, Encoding.UTF8).Trim(), out p) && p > 0) pid = p;
                }
            }
            catch { }

            int selfPid = Process.GetCurrentProcess().Id;
            if (pid.HasValue && pid.Value != selfPid)
            {
                CdpHelper.WatcherPidClassification cls = CdpHelper.ClassifyWatcherPid(pid.Value, dir);
                if (cls.Status == CdpHelper.WatcherPidStatus.Unknown)
                {
                    // Fail closed: cannot verify process ownership, refuse to signal/kill or delete .watch.pid.
                    return;
                }
                if (cls.Status == CdpHelper.WatcherPidStatus.Dead || cls.Status == CdpHelper.WatcherPidStatus.Foreign)
                {
                    try { if (File.Exists(pidFile)) File.Delete(pidFile); } catch { }
                    return;
                }

                string hash = GetDirHash(dir);
                try
                {
                    using (EventWaitHandle stopEvt = EventWaitHandle.OpenExisting("Local\\AGYClaudeStudioStop_" + hash))
                    {
                        stopEvt.Set();
                    }
                }
                catch { }

                try
                {
                    using (Process proc = Process.GetProcessById(pid.Value))
                    {
                        if (!proc.WaitForExit(1500))
                        {
                            proc.Kill();
                            proc.WaitForExit(1500);
                        }
                    }
                }
                catch { }
            }
            try { if (File.Exists(pidFile)) File.Delete(pidFile); } catch { }
        }

        private static Dictionary<string, object> Child(Dictionary<string, object> d, string key)
        {
            object v; return d != null && d.TryGetValue(key, out v) ? v as Dictionary<string, object> : null;
        }
        private static int Id(Dictionary<string, object> d, string key)
        {
            object v; return d != null && d.TryGetValue(key, out v) ? Convert.ToInt32(v) : 0;
        }

        private static bool GetConfigBool(Dictionary<string, object> cfg, string key, bool fallback)
        {
            object v;
            if (cfg != null && cfg.TryGetValue(key, out v) && v is bool)
            {
                return (bool)v;
            }
            return fallback;
        }

        private static async Task<int> RunLaunchAndWatchAsync(
            int? overridePort,
            bool relaunchFlag,
            bool replaceExisting,
            int? parentPid,
            int startupGraceSeconds,
            string outFile)
        {
            PluginManifest manifest = PluginManifest.Load(_baseDir);
            Dictionary<string, object> initCfg = CdpHelper.ReadConfig(_baseDir, manifest);
            if (!HostEnabled()) return await RunWatchAsync(overridePort, true, parentPid, true, startupGraceSeconds, replaceExisting, true).ConfigureAwait(false);
            bool allowRelaunch = relaunchFlag || GetConfigBool(initCfg, "autoRelaunchWithCdp", true);

            EnsureAntigravityResult res = await CdpHelper.EnsureAntigravityWithCdpAsync(null, allowRelaunch, overridePort, 8000).ConfigureAwait(false);
            if (!res.Ok)
            {
                Log("[!] " + res.Message);
                WriteResult(outFile, false, res.Message, null);
                ShowLaunchErrorUiIfAllowed(outFile, res.Message);
                return 1;
            }

            string launchSummary = string.Format("[▶] 启动完成 ({0}): {1}", res.Action, res.Message);
            return await RunWatchAsync(overridePort, true, parentPid, true, startupGraceSeconds, replaceExisting, true, launchSummary).ConfigureAwait(false);
        }

        private static async Task<int> RunWatchAsync(
            int? overridePort,
            bool exitOnHostCloseFlag,
            int? parentPid,
            bool startupGraceEnabled,
            int startupGraceSeconds,
            bool replaceExisting,
            bool waitForLock,
            string initialLog = null)
        {
            string dirHash = GetDirHash(_baseDir);
            if (replaceExisting)
            {
                StopRunningWatcherInDir(_baseDir);
            }

            string mutexName = "Local\\AGYClaudeStudioWatcher_" + dirHash;
            Mutex mutex = new Mutex(false, mutexName);
            bool hasMutex = false;
            try
            {
                try
                {
                    hasMutex = mutex.WaitOne(waitForLock ? 1500 : 0, false);
                }
                catch (AbandonedMutexException)
                {
                    hasMutex = true;
                }

                if (!hasMutex)
                {
                    return 0;
                }

                int selfPid = Process.GetCurrentProcess().Id;
                int? existingPid = ReadPidFile();
                if (existingPid.HasValue && existingPid.Value != selfPid)
                {
                    CdpHelper.WatcherPidClassification cls = CdpHelper.ClassifyWatcherPid(existingPid.Value, _baseDir);
                    if (cls.Status == CdpHelper.WatcherPidStatus.Unknown)
                    {
                        Log(string.Format("[!] 无法验证 .watch.pid 进程归属 (PID {0})，出于安全策略拒绝覆盖锁文件", existingPid.Value));
                        return 1;
                    }
                    if (cls.Status == CdpHelper.WatcherPidStatus.Owned)
                    {
                        Log(string.Format("[*] 检测到同目录守护进程已在运行 (PID {0})，退出重复实例", existingPid.Value));
                        return 0;
                    }
                }

                File.WriteAllText(_pidFile, selfPid.ToString(), new UTF8Encoding(false));
                try { File.WriteAllText(_logFile, "", new UTF8Encoding(false)); } catch { }
                if (!string.IsNullOrEmpty(initialLog))
                {
                    Log(initialLog);
                }

                PluginManifest manifest = PluginManifest.Load(_baseDir);
                Dictionary<string, object> initCfg = CdpHelper.ReadConfig(_baseDir, manifest);
                bool cfgAutoRelaunch = GetConfigBool(initCfg, "autoRelaunchWithCdp", true);
                bool cfgExitOnHostClose = GetConfigBool(initCfg, "exitOnHostClose", false);

                Log(string.Format("[*] Claude Studio (agy-claude-studio) {0}启动 (PID {1})，每 {2}ms 检查一次窗口",
                    exitOnHostCloseFlag ? "托管监听模式" : "守护模式", selfPid, _pollMs));

                string currentCodeHash;
                string currentCssHash;
                CdpHelper.ReadBundleAndCssHashes(_baseDir, manifest, out currentCodeHash, out currentCssHash);
                string currentExpr = CdpHelper.BuildInjectExpression(_baseDir, manifest);
                string currentConfigExpr = CdpHelper.BuildConfigScriptExpression(_baseDir, manifest, currentCodeHash);
                object exprLock = new object();
                bool hadAttachedWindow = false;
                ConcurrentDictionary<string, AttachedEntry> attached = new ConcurrentDictionary<string, AttachedEntry>(StringComparer.Ordinal);
                ManualResetEventSlim exitEvent = new ManualResetEventSlim(false);
                EventWaitHandle stopSignal = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\AGYClaudeStudioStop_" + dirHash);

                RegisteredWaitHandle stopWaitReg = ThreadPool.RegisterWaitForSingleObject(stopSignal, (state, timedOut) =>
                {
                    try { exitEvent.Set(); } catch { }
                }, null, -1, true);

                AppDomain.CurrentDomain.ProcessExit += (s, e) =>
                {
                    try { exitEvent.Set(); } catch { }
                    ReleasePidFile(selfPid);
                };

                Func<AttachedEntry, string, string, bool, Task<Dictionary<string, object>>> writeScripts = async (entry, fullExprToUse, configExprToUse, refreshOnly) =>
                {
                    if (refreshOnly && !string.IsNullOrEmpty(entry.BootstrapScriptId) && !string.IsNullOrEmpty(configExprToUse))
                    {
                        if (!string.IsNullOrEmpty(entry.ConfigScriptId))
                        {
                            try
                            {
                                Dictionary<string, object> rmCfg = new Dictionary<string, object>(StringComparer.Ordinal);
                                rmCfg["identifier"] = entry.ConfigScriptId;
                                await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmCfg, 5000).ConfigureAwait(false);
                            }
                            catch { }
                            entry.ConfigScriptId = null;
                        }
                        Dictionary<string, object> addCfgParams = new Dictionary<string, object>(StringComparer.Ordinal);
                        addCfgParams["source"] = configExprToUse;
                        Dictionary<string, object> addCfgRes = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addCfgParams, 15000).ConfigureAwait(false);
                        object cfgIdVal;
                        if (addCfgRes.TryGetValue("identifier", out cfgIdVal)) entry.ConfigScriptId = cfgIdVal as string;

                        try
                        {
                            object fastVal = await entry.Session.EvaluateAsync(configExprToUse, false).ConfigureAwait(false);
                            Dictionary<string, object> fastDict = fastVal as Dictionary<string, object>;
                            object stObj;
                            if (fastDict != null && fastDict.TryGetValue("status", out stObj) && string.Equals(stObj as string, "refreshed", StringComparison.Ordinal))
                            {
                                return fastDict;
                            }
                        }
                        catch { }
                    }

                    if (!string.IsNullOrEmpty(entry.ConfigScriptId))
                    {
                        try
                        {
                            Dictionary<string, object> rmCfg = new Dictionary<string, object>(StringComparer.Ordinal);
                            rmCfg["identifier"] = entry.ConfigScriptId;
                            await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmCfg, 5000).ConfigureAwait(false);
                        }
                        catch { }
                        entry.ConfigScriptId = null;
                    }
                    if (!string.IsNullOrEmpty(entry.BootstrapScriptId))
                    {
                        try
                        {
                            Dictionary<string, object> rmBoot = new Dictionary<string, object>(StringComparer.Ordinal);
                            rmBoot["identifier"] = entry.BootstrapScriptId;
                            await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmBoot, 5000).ConfigureAwait(false);
                        }
                        catch { }
                        entry.BootstrapScriptId = null;
                    }
                    Dictionary<string, object> addBootParams = new Dictionary<string, object>(StringComparer.Ordinal);
                    addBootParams["source"] = fullExprToUse;
                    Dictionary<string, object> addBootRes = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addBootParams, 15000).ConfigureAwait(false);
                    object bootIdVal;
                    if (addBootRes.TryGetValue("identifier", out bootIdVal)) entry.BootstrapScriptId = bootIdVal as string;

                    if (!string.IsNullOrEmpty(configExprToUse))
                    {
                        Dictionary<string, object> addCfgParams = new Dictionary<string, object>(StringComparer.Ordinal);
                        addCfgParams["source"] = configExprToUse;
                        Dictionary<string, object> addCfgRes = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addCfgParams, 15000).ConfigureAwait(false);
                        object cfgIdVal;
                        if (addCfgRes.TryGetValue("identifier", out cfgIdVal)) entry.ConfigScriptId = cfgIdVal as string;
                        try
                        {
                            await entry.Session.EvaluateAsync(configExprToUse, false).ConfigureAwait(false);
                        }
                        catch { }
                    }

                    object evalVal = await entry.Session.EvaluateAsync(fullExprToUse, false).ConfigureAwait(false);
                    return evalVal as Dictionary<string, object>;
                };

                Func<AttachedEntry, string, string, bool, Task<Dictionary<string, object>>> applyAsync = async (entry, expr, cfg, refreshOnly) =>
                {
                    await entry.ScriptLock.WaitAsync().ConfigureAwait(false);
                    try
                    {
                        if (entry.Retired || !HostEnabled()) throw new OperationCanceledException("plugin disabled");
                        return await writeScripts(entry, expr, cfg, refreshOnly).ConfigureAwait(false);
                    }
                    finally { entry.ScriptLock.Release(); }
                };

                Func<CdpPageInfo, Task> attachAsync = async (page) =>
                {
                    if (!attached.TryAdd(page.Id, null)) return;
                    CdpSession session = null;
                    try
                    {
                        session = await CdpSession.ConnectAsync(page.WebSocketDebuggerUrl, 4000).ConfigureAwait(false);
                        AttachedEntry entry = new AttachedEntry();
                        entry.Session = session;
                        entry.BootstrapScriptId = null;
                        entry.ConfigScriptId = null;
                        entry.Title = CdpHelper.ShortTitle(page);
                        attached[page.Id] = entry;

                        session.OnClose = () =>
                        {
                            AttachedEntry ignored;
                            attached.TryRemove(page.Id, out ignored);
                            Log("[-] 窗口已关闭: " + entry.Title);
                        };

                        await session.SendAsync("Page.enable", null, 5000).ConfigureAwait(false);
                        var worlds = new ConcurrentDictionary<int, Dictionary<string, object>>();
                        session.On("Runtime.executionContextCreated", p => {
                            var c = Child(p, "context"); var aux = Child(c, "auxData"); int id = Id(c, "id");
                            Dictionary<string, object> ignored;
                            worlds.TryRemove(id, out ignored);
                            if (id > 0 && GetConfigBool(aux, "isDefault", false)) worlds[id] = aux;
                        });
                        session.On("Runtime.executionContextDestroyed", p => { Dictionary<string, object> ignored; worlds.TryRemove(Id(p, "executionContextId"), out ignored); });
                        session.On("Runtime.executionContextsCleared", p => worlds.Clear());
                        Func<int, bool, Task<bool>> trustedSource = async (id, fileAction) => {
                            Dictionary<string, object> world, live;
                            if (!worlds.TryGetValue(id, out world) || !CdpHelper.IsHostPage(page, page.Url)) return false;
                            var tree = await session.SendAsync("Page.getFrameTree", null, 3000).ConfigureAwait(false);
                            var frame = Child(Child(tree, "frameTree"), "frame");
                            return frame != null && !frame.ContainsKey("parentId") && world.ContainsKey("frameId") &&
                                frame.ContainsKey("id") && Equals(frame["id"], world["frameId"]) && frame.ContainsKey("url") &&
                                (fileAction ? CdpHelper.IsFileActionDocument(page, frame["url"] as string) : CdpHelper.IsHostPage(page, frame["url"] as string)) &&
                                worlds.TryGetValue(id, out live) && ReferenceEquals(world, live);
                        };
                        session.On("Runtime.bindingCalled", (p) =>
                        {
                            if (entry.Retired) return;
                            object bNameObj;
                            object payloadObj;
                            if (!p.TryGetValue("name", out bNameObj) || !string.Equals(bNameObj as string, manifest.SettingBinding, StringComparison.Ordinal)) return;
                            if (!p.TryGetValue("payload", out payloadObj) || !(payloadObj is string)) return;
                            int executionContextId = Id(p, "executionContextId");
                            try
                            {
                                Dictionary<string, object> kv = MiniJson.ParseObject((string)payloadObj);
                                object actionObj;
                                if (kv.TryGetValue("action", out actionObj) && string.Equals(actionObj as string, "fileLinkAction", StringComparison.Ordinal))
                                {
                                    object uriObj, modeObj, requestObj;
                                    string rawUri = kv.TryGetValue("uri", out uriObj) ? uriObj as string : null;
                                    string mode = kv.TryGetValue("mode", out modeObj) ? modeObj as string : null;
                                    string requestId = kv.TryGetValue("requestId", out requestObj) ? requestObj as string : null;
                                    Task.Run(async () =>
                                    {
                                        if (!await trustedSource(executionContextId, true).ConfigureAwait(false)) return;
                                        bool ok = GetConfigBool(CdpHelper.ReadConfig(_baseDir, manifest), "fileLinkContextMenu", true) && WindowsFileAction.Run(rawUri, mode);
                                        Dictionary<string, object> response = new Dictionary<string, object>(StringComparer.Ordinal);
                                        response["requestId"] = requestId ?? "";
                                        response["ok"] = ok;
                                        response["mode"] = mode;
                                        string json = MiniJson.Stringify(response, false);
                                        try { await session.EvaluateAsync("window.__agClaudeStudio && window.__agClaudeStudio.onFileLinkActionResult(" + json + ")", false).ConfigureAwait(false); } catch { }
                                    });
                                    return;
                                }
                                object kObj;
                                object vObj;
                                if (kv.TryGetValue("key", out kObj) && kObj is string && kv.TryGetValue("value", out vObj))
                                {
                                    string key = (string)kObj;
                                    if (key == "fileLinkContextMenu")
                                    {
                                        Task.Run(async () => { if (await trustedSource(executionContextId, false).ConfigureAwait(false)) CdpHelper.UpdateConfigSetting(_baseDir, manifest, key, vObj); });
                                        return;
                                    }
                                    if (CdpHelper.UpdateConfigSetting(_baseDir, manifest, key, vObj))
                                    {
                                        Log("[⚙] 设置已保存: " + key + " = " + MiniJson.Stringify(vObj, false));
                                    }
                                }
                            }
                            catch { }
                        });

                        await session.SendAsync("Runtime.enable", null, 5000).ConfigureAwait(false);
                        Dictionary<string, object> bindParams = new Dictionary<string, object>(StringComparer.Ordinal);
                        bindParams["name"] = manifest.SettingBinding;
                        await session.SendAsync("Runtime.addBinding", bindParams, 5000).ConfigureAwait(false);

                        string exprSnapshot;
                        string cfgExprSnapshot;
                        lock (exprLock)
                        {
                            exprSnapshot = currentExpr;
                            cfgExprSnapshot = currentConfigExpr;
                        }
                        Dictionary<string, object> res = await applyAsync(entry, exprSnapshot, cfgExprSnapshot, false).ConfigureAwait(false);
                        string status = (res != null && res.ContainsKey("status")) ? Convert.ToString(res["status"]) : "ok";
                        lock (exprLock) { hadAttachedWindow = true; }
                        Log(string.Format("[✓] 已注入 agy-claude-studio: {0} ({1})", entry.Title, status));
                    }
                    catch (Exception ex)
                    {
                        AttachedEntry removed;
                        if (attached.TryRemove(page.Id, out removed) && removed != null && removed.Session != null)
                        {
                            try { removed.Session.Close(); } catch { }
                        }
                        if (session != null)
                        {
                            try { session.Close(); } catch { }
                        }
                        Log(string.Format("[!] 注入失败，稍后重试: {0} — {1}", CdpHelper.ShortTitle(page), ex.Message));
                    }
                };

                Timer reloadTimer = null;
                string pendingFilename = null;
                object timerLock = new object();

                FileSystemWatcher fsw = null;
                try
                {
                    fsw = new FileSystemWatcher(_baseDir);
                    fsw.IncludeSubdirectories = false;
                    fsw.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.CreationTime;
                    FileSystemEventHandler onFsChange = (sender, e) =>
                    {
                        string name = e.Name;
                        if (string.IsNullOrEmpty(name) || name.StartsWith(".", StringComparison.Ordinal)) return;
                        if (!name.EndsWith(".css", StringComparison.OrdinalIgnoreCase) &&
                            !name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) &&
                            !name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                        {
                            return;
                        }
                        lock (timerLock)
                        {
                            pendingFilename = name;
                            if (reloadTimer == null)
                            {
                                reloadTimer = new Timer(async (_) =>
                                {
                                    string changedName;
                                    lock (timerLock) { changedName = pendingFilename; }
                                    try
                                    {
                                        manifest = PluginManifest.Load(_baseDir);
                                        Dictionary<string, object> nextCfg = CdpHelper.ReadConfig(_baseDir, manifest);
                                        string nextCodeHash;
                                        string nextCssHash;
                                        CdpHelper.ReadBundleAndCssHashes(_baseDir, manifest, out nextCodeHash, out nextCssHash);
                                        string nextConfigExpr = CdpHelper.BuildConfigScriptExpression(_baseDir, manifest, nextCodeHash);
                                        bool refreshOnly;
                                        string nextExpr;
                                        lock (exprLock)
                                        {
                                            refreshOnly = !string.IsNullOrEmpty(currentCodeHash) &&
                                                string.Equals(nextCodeHash, currentCodeHash, StringComparison.Ordinal) &&
                                                string.Equals(nextCssHash, currentCssHash, StringComparison.Ordinal);
                                            nextExpr = refreshOnly ? currentExpr : CdpHelper.BuildInjectExpression(_baseDir, manifest);
                                            currentCodeHash = nextCodeHash;
                                            currentCssHash = nextCssHash;
                                            currentExpr = nextExpr;
                                            currentConfigExpr = nextConfigExpr;

                                            cfgAutoRelaunch = GetConfigBool(nextCfg, "autoRelaunchWithCdp", true);
                                            cfgExitOnHostClose = GetConfigBool(nextCfg, "exitOnHostClose", false);
                                        }

                                        int n = 0;
                                        foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                                        {
                                            AttachedEntry entry = kv.Value;
                                            if (entry == null) continue;
                                            try
                                            {
                                                await applyAsync(entry, nextExpr, nextConfigExpr, refreshOnly).ConfigureAwait(false);
                                                n++;
                                            }
                                            catch { }
                                        }
                                        Log(string.Format("[↻] {0} 已变更，已热更新 {1} 个窗口{2}", changedName, n, refreshOnly ? "（轻量配置同步）" : ""));
                                    }
                                    catch (Exception ex)
                                    {
                                        Log("[!] 读取文件失败: " + ex.Message);
                                    }
                                }, null, 180, Timeout.Infinite);
                            }
                            else
                            {
                                reloadTimer.Change(180, Timeout.Infinite);
                            }
                        }
                    };
                    fsw.Changed += onFsChange;
                    fsw.Created += onFsChange;
                    fsw.Renamed += (s, e) => onFsChange(s, e);
                    fsw.EnableRaisingEvents = true;
                }
                catch { }

                bool isExplicitPort = overridePort.HasValue || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AG_CDP_PORT"));
                int? lastPort = null;
                int consecutivePortFailures = 0;
                int noCdpRunningTicks = 0;
                string warnedNoCdpSig = "";
                string relaunchedPidSig = "";
                DateTime lastRelaunchUtc = DateTime.MinValue;
                string cdpFlagCheckedSig = "";
                bool cdpFlagCheckedVal = false;
                DateTime watchStartUtc = DateTime.UtcNow;

                try
                {
                    while (!exitEvent.IsSet)
                    {
                        if (parentPid.HasValue && !CdpHelper.IsProcessAlive(parentPid.Value))
                        {
                            Log("[*] 父进程 " + parentPid.Value + " 已退出，守护进程自动停止");
                            break;
                        }

                        int sleepMs = _pollMs;
                        try
                        {
                            bool enabled = HostEnabled();
                            if (!enabled)
                            {
                                var cleanup = new List<Task>();
                                foreach (var kv in attached)
                                {
                                    AttachedEntry old;
                                    if (!attached.TryRemove(kv.Key, out old) || old == null) continue;
                                    old.Session.OnClose = null;
                                    cleanup.Add(RetireAsync(old, manifest.RemoveExpression));
                                }
                                await Task.WhenAll(cleanup).ConfigureAwait(false);
                                bool monitorExit;
                                lock (exprLock) { monitorExit = exitOnHostCloseFlag || cfgExitOnHostClose; }
                                if (!monitorExit) { exitEvent.Wait(sleepMs); continue; }
                            }
                            int? port = CdpHelper.ReadPort(overridePort);
                            List<CdpPageInfo> pages = null;
                            if (port.HasValue)
                            {
                                try
                                {
                                    pages = await CdpHelper.ListPagesAsync(port.Value).ConfigureAwait(false);
                                }
                                catch
                                {
                                    pages = null;
                                }
                            }

                            if (port.HasValue && pages != null)
                            {
                                consecutivePortFailures = 0;
                                noCdpRunningTicks = 0;
                                warnedNoCdpSig = "";
                                cdpFlagCheckedSig = "";
                                cdpFlagCheckedVal = false;

                                if (!lastPort.HasValue || lastPort.Value != port.Value)
                                {
                                    // Close stale sessions if Antigravity restarted on a new port
                                    foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                                    {
                                        AttachedEntry oldEntry;
                                        if (attached.TryRemove(kv.Key, out oldEntry) && oldEntry != null && oldEntry.Session != null)
                                        {
                                            try { oldEntry.Session.Close(); } catch { }
                                        }
                                    }
                                    Log("[+] 连接到调试端口 " + port.Value);
                                    lastPort = port.Value;
                                }

                                List<Task> tasks = new List<Task>();
                                for (int i = 0; i < pages.Count; i++)
                                {
                                    if (enabled && !attached.ContainsKey(pages[i].Id))
                                    {
                                        tasks.Add(attachAsync(pages[i]));
                                    }
                                }
                                if (tasks.Count > 0)
                                {
                                    await Task.WhenAll(tasks).ConfigureAwait(false);
                                }
                            }
                            else
                            {
                                consecutivePortFailures++;
                                if (consecutivePortFailures >= 3)
                                {
                                    foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                                    {
                                        AttachedEntry oldEntry;
                                        if (attached.TryRemove(kv.Key, out oldEntry) && oldEntry != null && oldEntry.Session != null)
                                        {
                                            try { oldEntry.Session.Close(); } catch { }
                                        }
                                    }
                                    lastPort = null;
                                }

                                bool hadWin;
                                bool autoRelaunch;
                                bool exitOnClose;
                                lock (exprLock)
                                {
                                    hadWin = hadAttachedWindow;
                                    autoRelaunch = cfgAutoRelaunch;
                                    exitOnClose = exitOnHostCloseFlag || cfgExitOnHostClose;
                                }

                                List<int> runningPids = isExplicitPort ? new List<int>() : CdpHelper.GetAntigravityProcessIds();
                                if (exitOnClose && hadWin && attached.IsEmpty && consecutivePortFailures >= 3 && runningPids.Count == 0)
                                {
                                    Log("[*] Antigravity 宿主已关闭，守护进程自动退出");
                                    break;
                                }
                                if (exitOnClose && startupGraceEnabled && !hadWin && attached.IsEmpty && consecutivePortFailures >= 2 &&
                                    runningPids.Count == 0 && (DateTime.UtcNow - watchStartUtc).TotalSeconds >= startupGraceSeconds)
                                {
                                    Log(string.Format("[*] 超过启动宽限 ({0}s) 仍未检测到 Antigravity 窗口，监听自动退出", startupGraceSeconds));
                                    break;
                                }

                                if (enabled && runningPids.Count > 0)
                                {
                                    noCdpRunningTicks++;
                                    string pidSig = string.Join(",", runningPids);
                                    if (noCdpRunningTicks >= 3)
                                    {
                                        if (cdpFlagCheckedSig != pidSig)
                                        {
                                            cdpFlagCheckedSig = pidSig;
                                            cdpFlagCheckedVal = CdpHelper.HasAntigravityCdpFlag();
                                        }
                                        if (cdpFlagCheckedVal)
                                        {
                                            if (warnedNoCdpSig != "cdp:" + pidSig)
                                            {
                                                warnedNoCdpSig = "cdp:" + pidSig;
                                                Log("[*] 检测到 Antigravity 已携带 --remote-debugging-port 参数，继续等待调试端口响应...");
                                            }
                                        }
                                        else
                                        {
                                            if (warnedNoCdpSig != pidSig)
                                            {
                                                warnedNoCdpSig = pidSig;
                                                Log("[!] " + CdpHelper.CdpUnavailableMessage(true, port));
                                                if (!autoRelaunch)
                                                {
                                                    Log("[*] 提示：可在 config.json 中设置 \"autoRelaunchWithCdp\": true 以启用自动温和重启接管");
                                                }
                                            }
                                            if (enabled && autoRelaunch && HostEnabled() && relaunchedPidSig != pidSig &&
                                                (DateTime.UtcNow - lastRelaunchUtc).TotalSeconds >= 60.0)
                                            {
                                                relaunchedPidSig = pidSig;
                                                lastRelaunchUtc = DateTime.UtcNow;
                                                Log("[↻] autoRelaunchWithCdp 已启用：正在温和重启 Antigravity 并附加 --remote-debugging-port=0 ...");
                                                bool ok = CdpHelper.RelaunchAntigravityWithCdp(null, 0, 8000);
                                                if (ok)
                                                {
                                                    Log("[✓] 已以 CDP 模式重启 Antigravity，等待窗口就绪...");
                                                    noCdpRunningTicks = 0;
                                                    cdpFlagCheckedSig = "";
                                                    cdpFlagCheckedVal = false;
                                                }
                                                else
                                                {
                                                    Log("[!] 自动重启未完成，请手动完全退出 Antigravity 后以 --remote-debugging-port=0 启动");
                                                }
                                            }
                                        }
                                    }
                                }
                                else
                                {
                                    noCdpRunningTicks = 0;
                                    warnedNoCdpSig = "";
                                    cdpFlagCheckedSig = "";
                                    cdpFlagCheckedVal = false;
                                    if (consecutivePortFailures >= 3 && !(startupGraceEnabled && !hadWin))
                                    {
                                        sleepMs = Math.Max(_pollMs, 5000);
                                    }
                                }
                            }
                        }
                        catch { }

                        exitEvent.Wait(sleepMs);
                    }
                }
                finally
                {
                    if (fsw != null) { try { fsw.Dispose(); } catch { } }
                    if (reloadTimer != null) { try { reloadTimer.Dispose(); } catch { } }
                    foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                    {
                        if (kv.Value != null && kv.Value.Session != null)
                        {
                            try { kv.Value.Session.Close(); } catch { }
                        }
                    }
                    try { stopWaitReg.Unregister(null); } catch { }
                    try { stopSignal.Dispose(); } catch { }
                    try { exitEvent.Dispose(); } catch { }
                    ReleasePidFile(selfPid);
                }
            }
            finally
            {
                if (hasMutex)
                {
                    try { mutex.ReleaseMutex(); } catch { }
                }
                try { mutex.Dispose(); } catch { }
            }
            return 0;
        }
    }
}
