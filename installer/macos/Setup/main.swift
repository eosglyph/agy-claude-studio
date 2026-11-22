import Cocoa
import Foundation
#if canImport(Darwin)
import Darwin
#endif

final class InstallerOptions {
    var uninstall = false
    var silent = false
    var popup = false
    var statusOnly = false
    var noAutostart = false
    var noKillLegacy = false
    var runMode: String?
    var modeExplicit = false
    var createAppLauncher = true
    var noAppLauncher = false
    var installDir: String?
    var cdpPort: Int?
    var outFile: String?
}

struct AntigravityDetectResult {
    var appPath: String?
    var version: String?
    var isRunning = false
}

final class OperationResult {
    var ok = false
    var mode = "install"
    var runMode = "managed"
    var headline = ""
    var detail = ""
    var installDir = ""
    var antigravityApp: String?
    var antigravityVersion: String?
    var antigravityRunningWithoutCdp = false
    var cdpPort: Int?
    var injectedPages: [String] = []
    var preservedExistingConfig = false
    var watcherStarted = false
    var launcherAppPath: String?
    var launchAgentActive = false
    var configSummary = ""
}

enum InstallerCore {
    static let launchAgentLabel = "io.github.eosglyph.agy-claude-studio"
    static let launchAgentFileName = "io.github.eosglyph.agy-claude-studio.plist"
    static let launcherAppName = "Antigravity (Claude Studio).app"
    static let launcherBundleId = "io.github.eosglyph.agy-claude-studio.launcher"
    static let installModeFileName = ".install-mode"
    static let watcherExeName = "agy-claude-studio-watcher"
    static let selfInstalledExeName = "agy-claude-studio-installer"

    static func getTestSystemRoot() -> String? {
        guard let raw = ProcessInfo.processInfo.environment["AGY_CS_TEST_SYSTEM_ROOT"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: raw).standardizedFileURL.path
    }

    static func getDefaultInstallDir() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return (home as NSString).appendingPathComponent("Library/Application Support/agy-claude-studio")
    }

    static func getLaunchAgentPlistPath() -> String {
        if let testRoot = getTestSystemRoot() {
            return ((testRoot as NSString).appendingPathComponent("LaunchAgents") as NSString)
                .appendingPathComponent(launchAgentFileName)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ((home as NSString).appendingPathComponent("Library/LaunchAgents") as NSString)
            .appendingPathComponent(launchAgentFileName)
    }

    static func getApplicationsLauncherAppPath() -> String {
        if let testRoot = getTestSystemRoot() {
            return ((testRoot as NSString).appendingPathComponent("Applications") as NSString)
                .appendingPathComponent(launcherAppName)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ((home as NSString).appendingPathComponent("Applications") as NSString)
            .appendingPathComponent(launcherAppName)
    }

    static func readInstalledMode(dir: String) -> String? {
        let modePath = (dir as NSString).appendingPathComponent(installModeFileName)
        guard let raw = try? String(contentsOfFile: modePath, encoding: .utf8) else { return nil }
        let val = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if val == "managed" || val == "daemon" {
            return val
        }
        return nil
    }

    static func writeInstalledMode(dir: String, mode: String) throws {
        let normalized = (mode == "daemon") ? "daemon" : "managed"
        let modePath = (dir as NSString).appendingPathComponent(installModeFileName)
        try (normalized + "\n").write(toFile: modePath, atomically: true, encoding: .utf8)
    }

    static func resolveRunMode(opts: InstallerOptions, installDir: String) -> String {
        if opts.modeExplicit, let explicit = opts.runMode?.lowercased(),
           explicit == "managed" || explicit == "daemon" {
            return explicit
        }
        if opts.noAutostart {
            return "managed"
        }
        if let installed = readInstalledMode(dir: installDir) {
            return installed
        }
        if FileManager.default.fileExists(atPath: getLaunchAgentPlistPath()) {
            return "daemon"
        }
        return "managed"
    }

    static func shellSingleQuote(_ s: String) -> String {
        return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func resolvePayloadDir() -> String? {
        let fm = FileManager.default
        if let resPath = Bundle.main.resourcePath {
            let p = (resPath as NSString).appendingPathComponent("payload")
            if fm.fileExists(atPath: (p as NSString).appendingPathComponent("manifest.json")) {
                return p
            }
        }
        let execPath = resolvedSelfExecutablePath()
        let execDir = (execPath as NSString).deletingLastPathComponent
        let contentsDir = (execDir as NSString).deletingLastPathComponent
        let relPayload = ((contentsDir as NSString).appendingPathComponent("Resources") as NSString)
            .appendingPathComponent("payload")
        if fm.fileExists(atPath: (relPayload as NSString).appendingPathComponent("manifest.json")) {
            return relPayload
        }
        return nil
    }

    static func resolveWatcherBinarySource() -> String? {
        let fm = FileManager.default
        if let execPath = Bundle.main.executablePath {
            let dir = (execPath as NSString).deletingLastPathComponent
            let candidate = (dir as NSString).appendingPathComponent(watcherExeName)
            if fm.fileExists(atPath: candidate) { return candidate }
        }
        let selfPath = resolvedSelfExecutablePath()
        let selfDir = (selfPath as NSString).deletingLastPathComponent
        let sibling = (selfDir as NSString).appendingPathComponent(watcherExeName)
        if fm.fileExists(atPath: sibling) { return sibling }
        return nil
    }

    static func resolvedSelfExecutablePath() -> String {
        if let p = Bundle.main.executablePath, !p.isEmpty {
            return URL(fileURLWithPath: p).standardizedFileURL.path
        }
        let arg0 = CommandLine.arguments.first ?? ""
        return URL(fileURLWithPath: arg0).standardizedFileURL.path
    }

    @discardableResult
    static func runProcessSync(executable: String, arguments: [String]) -> (code: Int32, stdout: String) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = arguments
        let outPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = FileHandle.nullDevice
        proc.standardInput = FileHandle.nullDevice
        do {
            try proc.run()
            let data = outPipe.fileHandleForReading.readDataToEndOfFile()
            proc.waitUntilExit()
            let str = String(data: data, encoding: .utf8) ?? ""
            return (proc.terminationStatus, str)
        } catch {
            return (-1, "")
        }
    }

    static func detectAntigravityDesktop() -> AntigravityDetectResult {
        var res = AntigravityDetectResult()
        let running = NSWorkspace.shared.runningApplications
        for app in running {
            let bundleName = app.bundleURL?.lastPathComponent.lowercased() ?? ""
            let locName = app.localizedName?.lowercased() ?? ""
            let exeName = app.executableURL?.lastPathComponent.lowercased() ?? ""
            if bundleName == "antigravity.app" || locName == "antigravity" || exeName == "antigravity" {
                res.isRunning = true
                if let url = app.bundleURL {
                    res.appPath = url.path
                    break
                }
            }
        }

        let fm = FileManager.default
        if res.appPath == nil {
            let home = fm.homeDirectoryForCurrentUser.path
            let candidates = [
                "/Applications/Antigravity.app",
                (home as NSString).appendingPathComponent("Applications/Antigravity.app"),
            ]
            for path in candidates {
                if fm.fileExists(atPath: path) {
                    res.appPath = path
                    break
                }
            }
        }

        if let appPath = res.appPath {
            let plistPath = ((appPath as NSString).appendingPathComponent("Contents") as NSString)
                .appendingPathComponent("Info.plist")
            if let dict = NSDictionary(contentsOfFile: plistPath) {
                if let shortVer = dict["CFBundleShortVersionString"] as? String, !shortVer.isEmpty {
                    res.version = shortVer
                } else if let ver = dict["CFBundleVersion"] as? String, !ver.isEmpty {
                    res.version = ver
                }
            }
        }
        return res
    }

    static func unloadLaunchAgent() {
        if getTestSystemRoot() != nil {
            return
        }
        let plistPath = getLaunchAgentPlistPath()
        let uid = getuid()
        _ = runProcessSync(executable: "/bin/launchctl", arguments: ["bootout", "gui/\(uid)/\(launchAgentLabel)"])
        if FileManager.default.fileExists(atPath: plistPath) {
            _ = runProcessSync(executable: "/bin/launchctl", arguments: ["unload", "-w", plistPath])
        }
    }

    private static func terminatePid(_ pid: Int32) -> Bool {
        guard pid > 0, pid != getpid() else { return false }
        guard kill(pid, 0) == 0 else { return false }
        _ = kill(pid, SIGTERM)
        let deadline = Date().addingTimeInterval(2.0)
        while Date() < deadline {
            if kill(pid, 0) != 0 { return true }
            Thread.sleep(forTimeInterval: 0.05)
        }
        if kill(pid, 0) == 0 {
            _ = kill(pid, SIGKILL)
            Thread.sleep(forTimeInterval: 0.1)
        }
        return true
    }

    static func stopWatcherInDir(_ dir: String, noAutostart: Bool, log: ((String) -> Void)?) {
        let fm = FileManager.default
        if !noAutostart {
            unloadLaunchAgent()
        }
        guard fm.fileExists(atPath: dir) else { return }

        let selfPid = getpid()
        let pidFile = (dir as NSString).appendingPathComponent(".watch.pid")
        if let pidStr = try? String(contentsOfFile: pidFile, encoding: .utf8),
           let pid = Int32(pidStr.trimmingCharacters(in: .whitespacesAndNewlines)),
           pid > 0, pid != selfPid {
            let cls = CdpHelper.classifyWatcherPid(pid, baseDir: dir)
            switch cls.status {
            case .owned:
                if terminatePid(pid) {
                    log?("已停止运行中的守护进程 (PID \(pid))")
                }
                try? fm.removeItem(atPath: pidFile)
            case .dead, .foreign:
                // Never signal foreign processes; clear stale/reused .watch.pid pointer.
                try? fm.removeItem(atPath: pidFile)
            case .unknown:
                // Fail closed: cannot verify process ownership, refuse to terminate or remove lock.
                log?("无法验证 .watch.pid 进程归属 (PID \(pid))，已拒绝终止并保留锁文件")
            }
        }

        let ps = runProcessSync(executable: "/bin/ps", arguments: ["-ax", "-o", "pid=,command="])
        guard ps.code == 0 else { return }
        for rawLine in ps.stdout.components(separatedBy: CharacterSet.newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let parts = line.split(maxSplits: 1, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
            guard parts.count == 2, let pid = Int32(parts[0]), pid > 0, pid != selfPid else { continue }
            let cmd = String(parts[1])
            if CdpHelper.matchesWatcherForDir(command: cmd, baseDir: dir) && cmd.contains(watcherExeName) {
                _ = terminatePid(pid)
            }
        }
    }

    static func stopLegacyNodeWatchers(log: ((String) -> Void)?) {
        let ps = runProcessSync(executable: "/bin/ps", arguments: ["-ax", "-o", "pid=,command="])
        guard ps.code == 0 else { return }
        let selfPid = getpid()
        for rawLine in ps.stdout.components(separatedBy: CharacterSet.newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let parts = line.split(maxSplits: 1, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
            guard parts.count == 2, let pid = Int32(parts[0]), pid > 0, pid != selfPid else { continue }
            let rawCmd = String(parts[1])
            let lowerRaw = rawCmd.lowercased()
            if !lowerRaw.contains("agy-claude-studio") || !lowerRaw.contains("inject.js") || (!lowerRaw.contains("--watch") && !lowerRaw.contains("--managed")) {
                continue
            }

            guard let info = CdpHelper.inspectProcessInfo(pid: pid) else { continue }
            let cmd = info.cmd
            let leading = cmd.split(maxSplits: 1, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
            var rest = ""
            if let ep = info.exePath, !ep.isEmpty {
                let baseEp = (ep as NSString).lastPathComponent
                if cmd.hasPrefix(ep + " ") || cmd.hasPrefix(ep + "\t") {
                    rest = String(cmd.dropFirst(ep.count)).trimmingCharacters(in: .whitespacesAndNewlines)
                } else if cmd.hasPrefix(baseEp + " ") || cmd.hasPrefix(baseEp + "\t") {
                    rest = String(cmd.dropFirst(baseEp.count)).trimmingCharacters(in: .whitespacesAndNewlines)
                } else if !leading.isEmpty {
                    rest = String(cmd.dropFirst(leading.count)).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            } else if !leading.isEmpty {
                rest = String(cmd.dropFirst(leading.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }

            // Ambiguous if empty or starts with a pre-script flag (e.g. -e, --require) or non-absolute relative path.
            guard !rest.isEmpty, !rest.hasPrefix("-") else { continue }
            let unquoted = (rest.hasPrefix("\"") || rest.hasPrefix("'")) ? String(rest.dropFirst()) : rest
            guard unquoted.hasPrefix("/"),
                  let endRange = unquoted.range(of: "/inject.js", options: .caseInsensitive) else {
                continue
            }
            let afterIdx = endRange.upperBound
            if afterIdx < unquoted.endIndex {
                let nextCh = unquoted[afterIdx]
                if !nextCh.isWhitespace && nextCh != "\"" && nextCh != "'" { continue }
            }
            let scriptPath = String(unquoted[..<afterIdx])
            guard !scriptPath.contains(" --"),
                  FileManager.default.fileExists(atPath: scriptPath) else {
                continue
            }
            let parentDir = (scriptPath as NSString).deletingLastPathComponent
            guard !parentDir.isEmpty,
                  parentDir.lowercased().contains("agy-claude-studio") else {
                continue
            }

            let cls = CdpHelper.classifyWatcherPid(pid, baseDir: parentDir)
            if cls.status == .owned {
                if terminatePid(pid) {
                    log?("已替换旧版 Node 守护进程 (PID \(pid))")
                }
            }
        }
    }

    private static func xmlEscape(_ s: String) -> String {
        return s
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    static func registerLaunchAgent(installDir: String, cdpPort: Int?) throws {
        let plistPath = getLaunchAgentPlistPath()
        let launchAgentsDir = (plistPath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: launchAgentsDir, withIntermediateDirectories: true, attributes: nil)

        let watcherExe = (installDir as NSString).appendingPathComponent(watcherExeName)
        var args = [watcherExe, "--watch", "--dir", installDir]
        if let port = cdpPort, port > 0 {
            args.append("--cdp-port")
            args.append(String(port))
        }
        let argsXml = args.map { "    <string>\(xmlEscape($0))</string>" }.joined(separator: "\n")
        let outLog = (installDir as NSString).appendingPathComponent("launchd.out.log")
        let errLog = (installDir as NSString).appendingPathComponent("launchd.err.log")

        let plistContent = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>\(xmlEscape(launchAgentLabel))</string>
          <key>ProgramArguments</key>
          <array>
        \(argsXml)
          </array>
          <key>WorkingDirectory</key>
          <string>\(xmlEscape(installDir))</string>
          <key>RunAtLoad</key>
          <true/>
          <key>KeepAlive</key>
          <false/>
          <key>StandardOutPath</key>
          <string>\(xmlEscape(outLog))</string>
          <key>StandardErrorPath</key>
          <string>\(xmlEscape(errLog))</string>
        </dict>
        </plist>
        """
        try plistContent.write(toFile: plistPath, atomically: true, encoding: .utf8)

        if getTestSystemRoot() != nil {
            return
        }
        let uid = getuid()
        _ = runProcessSync(executable: "/bin/launchctl", arguments: ["bootout", "gui/\(uid)/\(launchAgentLabel)"])
        let bootRes = runProcessSync(executable: "/bin/launchctl", arguments: ["bootstrap", "gui/\(uid)", plistPath])
        if bootRes.code != 0 {
            _ = runProcessSync(executable: "/bin/launchctl", arguments: ["load", "-w", plistPath])
        }
    }

    static func createLauncherAppBundle(at appBundlePath: String, installDir: String, antigravityApp: String?) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: appBundlePath) {
            try fm.removeItem(atPath: appBundlePath)
        }
        let contentsDir = (appBundlePath as NSString).appendingPathComponent("Contents")
        let macosDir = (contentsDir as NSString).appendingPathComponent("MacOS")
        let resourcesDir = (contentsDir as NSString).appendingPathComponent("Resources")
        try fm.createDirectory(atPath: macosDir, withIntermediateDirectories: true, attributes: nil)
        try fm.createDirectory(atPath: resourcesDir, withIntermediateDirectories: true, attributes: nil)

        let watcherPath = (installDir as NSString).appendingPathComponent(watcherExeName)
        let scriptLines = [
            "#!/usr/bin/env bash",
            "nohup \(shellSingleQuote(watcherPath)) --launch --relaunch --exit-on-host-close --dir \(shellSingleQuote(installDir)) >/dev/null 2>&1 </dev/null &",
            "disown 2>/dev/null || true",
            "exit 0",
            ""
        ]
        let exePath = (macosDir as NSString).appendingPathComponent("launch-antigravity")
        try scriptLines.joined(separator: "\n").write(toFile: exePath, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: exePath)

        let pkgInfoPath = (contentsDir as NSString).appendingPathComponent("PkgInfo")
        try "APPL????".write(toFile: pkgInfoPath, atomically: true, encoding: .ascii)

        let plistContent = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>CFBundleDevelopmentRegion</key>
          <string>zh_CN</string>
          <key>CFBundleDisplayName</key>
          <string>Antigravity (Claude Studio)</string>
          <key>CFBundleExecutable</key>
          <string>launch-antigravity</string>
          <key>CFBundleIconFile</key>
          <string>AppIcon</string>
          <key>CFBundleIdentifier</key>
          <string>\(xmlEscape(launcherBundleId))</string>
          <key>CFBundleInfoDictionaryVersion</key>
          <string>6.0</string>
          <key>CFBundleName</key>
          <string>Antigravity (Claude Studio)</string>
          <key>CFBundlePackageType</key>
          <string>APPL</string>
          <key>CFBundleShortVersionString</key>
          <string>1.0.0</string>
          <key>CFBundleSignature</key>
          <string>????</string>
          <key>CFBundleVersion</key>
          <string>1.0.0</string>
          <key>LSMinimumSystemVersion</key>
          <string>11.0</string>
          <key>LSUIElement</key>
          <true/>
          <key>NSHighResolutionCapable</key>
          <true/>
        </dict>
        </plist>
        """
        let infoPlistPath = (contentsDir as NSString).appendingPathComponent("Info.plist")
        try (plistContent + "\n").write(toFile: infoPlistPath, atomically: true, encoding: .utf8)

        let destIconPath = (resourcesDir as NSString).appendingPathComponent("AppIcon.icns")
        var iconCopied = false
        if let agApp = antigravityApp, !agApp.isEmpty {
            let agPlistPath = ((agApp as NSString).appendingPathComponent("Contents") as NSString)
                .appendingPathComponent("Info.plist")
            if let dict = NSDictionary(contentsOfFile: agPlistPath),
               let rawIconName = dict["CFBundleIconFile"] as? String,
               !rawIconName.isEmpty {
                let iconFileName = rawIconName.lowercased().hasSuffix(".icns") ? rawIconName : (rawIconName + ".icns")
                let agIconPath = (((agApp as NSString).appendingPathComponent("Contents") as NSString)
                    .appendingPathComponent("Resources") as NSString)
                    .appendingPathComponent(iconFileName)
                if fm.fileExists(atPath: agIconPath) {
                    try? fm.copyItem(atPath: agIconPath, toPath: destIconPath)
                    iconCopied = fm.fileExists(atPath: destIconPath)
                }
            }
        }
        if !iconCopied, let resPath = Bundle.main.resourcePath {
            let fallbackIcon = (resPath as NSString).appendingPathComponent("AppIcon.icns")
            if fm.fileExists(atPath: fallbackIcon) {
                try? fm.copyItem(atPath: fallbackIcon, toPath: destIconPath)
            }
        }
    }

    private static func spawnWatcherDirectly(installDir: String, cdpPort: Int?, exitOnHostClose: Bool = false) throws {
        let watcherExe = (installDir as NSString).appendingPathComponent(watcherExeName)
        var args = ["--watch"]
        if exitOnHostClose {
            args.append("--exit-on-host-close")
        }
        args.append("--dir")
        args.append(installDir)
        if let port = cdpPort, port > 0 {
            args.append("--cdp-port")
            args.append(String(port))
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: watcherExe)
        proc.arguments = args
        proc.currentDirectoryURL = URL(fileURLWithPath: installDir)
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try proc.run()
    }

    static func runInstall(opts: InstallerOptions, progress: ((Int, String) -> Void)?) throws -> OperationResult {
        let result = OperationResult()
        result.mode = "install"
        let rawDir = (opts.installDir?.isEmpty == false) ? opts.installDir! : getDefaultInstallDir()
        let installDir = URL(fileURLWithPath: rawDir).standardizedFileURL.path
        result.installDir = installDir

        let runMode = resolveRunMode(opts: opts, installDir: installDir)
        result.runMode = runMode

        let report: (Int, String) -> Void = { pct, msg in
            progress?(pct, msg)
        }

        report(10, "正在检测本机 Antigravity Desktop 环境...")
        let ag = detectAntigravityDesktop()
        result.antigravityApp = ag.appPath
        result.antigravityVersion = ag.version
        if let appPath = ag.appPath {
            let verPart = (ag.version?.isEmpty == false) ? " (\(ag.version!))" : ""
            report(18, "已发现 Antigravity Desktop\(verPart): \(appPath)")
        } else {
            report(18, "未在默认目录检测到 Antigravity.app，仍将安装并启用 CDP 自动监听")
        }

        report(28, "正在停止旧版守护进程（如存在）...")
        stopWatcherInDir(installDir, noAutostart: opts.noAutostart) { msg in
            report(32, msg)
        }
        if !opts.noKillLegacy {
            stopLegacyNodeWatchers { msg in
                report(35, msg)
            }
        }

        report(45, "正在部署独立运行环境与插件资源至: \(installDir)")
        let fm = FileManager.default
        try fm.createDirectory(atPath: installDir, withIntermediateDirectories: true, attributes: nil)

        guard let payloadDir = resolvePayloadDir() else {
            throw CdpError("安装包内置资源 payload 缺失")
        }
        guard let watcherSrc = resolveWatcherBinarySource() else {
            throw CdpError("安装包内置守护程序 \(watcherExeName) 缺失")
        }

        var preservedConfig = false
        let payloadEntries = try fm.contentsOfDirectory(atPath: payloadDir)
        for name in payloadEntries {
            if name.hasPrefix(".") { continue }
            let src = (payloadDir as NSString).appendingPathComponent(name)
            let dest = (installDir as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: src, isDirectory: &isDir), !isDir.boolValue else { continue }

            if name.caseInsensitiveCompare("config.json") == .orderedSame && fm.fileExists(atPath: dest) {
                preservedConfig = true
                continue
            }
            if fm.fileExists(atPath: dest) {
                try fm.removeItem(atPath: dest)
            }
            try fm.copyItem(atPath: src, toPath: dest)
        }

        let watcherDest = (installDir as NSString).appendingPathComponent(watcherExeName)
        if fm.fileExists(atPath: watcherDest) {
            try fm.removeItem(atPath: watcherDest)
        }
        try fm.copyItem(atPath: watcherSrc, toPath: watcherDest)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: watcherDest)

        let selfSrc = resolvedSelfExecutablePath()
        let selfDest = (installDir as NSString).appendingPathComponent(selfInstalledExeName)
        if !selfSrc.isEmpty && fm.fileExists(atPath: selfSrc) && selfSrc != selfDest {
            if fm.fileExists(atPath: selfDest) {
                try? fm.removeItem(atPath: selfDest)
            }
            try? fm.copyItem(atPath: selfSrc, toPath: selfDest)
            try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: selfDest)
        }

        try writeInstalledMode(dir: installDir, mode: runMode)

        let localLauncherAppPath = (installDir as NSString).appendingPathComponent(launcherAppName)
        try? createLauncherAppBundle(at: localLauncherAppPath, installDir: installDir, antigravityApp: ag.appPath)
        result.launcherAppPath = localLauncherAppPath

        let launcherScriptPath = (installDir as NSString).appendingPathComponent("launch-antigravity.command")
        let quotedWatcher = shellSingleQuote(watcherDest)
        let quotedInstallDir = shellSingleQuote(installDir)
        let launcherScript = [
            "#!/usr/bin/env bash",
            "# Launch or restart Antigravity Desktop with CDP & managed watcher for Claude Studio",
            "nohup \(quotedWatcher) --launch --relaunch --exit-on-host-close --dir \(quotedInstallDir) >/dev/null 2>&1 </dev/null &",
            "disown 2>/dev/null || true",
            "if [ \"${TERM_PROGRAM:-}\" = \"Apple_Terminal\" ]; then",
            "  osascript -e 'tell application \"Terminal\" to if (count of windows) > 0 then close front window' >/dev/null 2>&1 || true",
            "fi",
            "exit 0",
            ""
        ].joined(separator: "\n")
        try? launcherScript.write(toFile: launcherScriptPath, atomically: true, encoding: .utf8)
        try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: launcherScriptPath)

        result.preservedExistingConfig = preservedConfig
        report(62, preservedConfig ? "已保留本机现有 config.json 用户配置" : "已写入内置默认配置 config.json")

        let manifest = try PluginManifest.load(baseDir: installDir)
        let activeCfg = CdpHelper.readConfig(baseDir: installDir, manifest: manifest)
        let lang = activeCfg["language"]?.stringValue ?? "zh-CN"
        let palette = activeCfg["palette"]?.stringValue ?? "obsidian"
        let ringMode = activeCfg["ringMode"]?.stringValue ?? "context"
        let effortStyle = activeCfg["effortSliderStyle"]?.stringValue ?? "claude"
        let autoRelaunchEnabled = activeCfg["autoRelaunchWithCdp"]?.boolValue ?? true
        result.configSummary = "语言=\(lang) | 配色=\(palette) | 圆环=\(ringMode) | 思考滑块=\(effortStyle)"

        if !opts.noAutostart {
            if opts.createAppLauncher && !opts.noAppLauncher {
                let appsLauncherPath = getApplicationsLauncherAppPath()
                try createLauncherAppBundle(at: appsLauncherPath, installDir: installDir, antigravityApp: ag.appPath)
                result.launcherAppPath = appsLauncherPath
                report(68, "已创建启动器: \(appsLauncherPath)")
            }
            if runMode == "daemon" {
                report(74, "正在配置 macOS LaunchAgent 登录自启（常驻守护模式）...")
                try registerLaunchAgent(installDir: installDir, cdpPort: opts.cdpPort)
                result.launchAgentActive = fm.fileExists(atPath: getLaunchAgentPlistPath())
            } else {
                report(74, "托管启动模式：不注册开机自启，清理已有 LaunchAgent...")
                unloadLaunchAgent()
                let plistPath = getLaunchAgentPlistPath()
                if fm.fileExists(atPath: plistPath) {
                    try? fm.removeItem(atPath: plistPath)
                }
                result.launchAgentActive = false
            }
        } else {
            report(74, "已按参数跳过 LaunchAgent 与启动器目录写入")
            result.launchAgentActive = fm.fileExists(atPath: getLaunchAgentPlistPath())
        }

        let probePort = CdpHelper.readPort(overridePort: opts.cdpPort)
        var cdpReachable = false
        if let p = probePort, (try? CdpHelper.listPages(port: p)) != nil {
            cdpReachable = true
        }
        let agHasCdpFlag = (opts.cdpPort == nil && ag.isRunning)
            ? CdpHelper.hasAntigravityCdpFlag(pids: CdpHelper.detectAntigravityProcessPids())
            : false

        var shouldVerifyInjection = false
        if runMode == "daemon" {
            if !opts.noAutostart && getTestSystemRoot() == nil {
                Thread.sleep(forTimeInterval: 0.25)
                let pidFile = (installDir as NSString).appendingPathComponent(".watch.pid")
                if !fm.fileExists(atPath: pidFile) {
                    report(82, "正在启动常驻后台守护进程...")
                    try spawnWatcherDirectly(installDir: installDir, cdpPort: opts.cdpPort, exitOnHostClose: false)
                }
            } else {
                report(82, "正在启动常驻后台守护进程...")
                try spawnWatcherDirectly(installDir: installDir, cdpPort: opts.cdpPort, exitOnHostClose: false)
            }
            result.watcherStarted = true
            shouldVerifyInjection = true
        } else {
            if cdpReachable || agHasCdpFlag {
                report(82, "检测到 Antigravity 已开启 CDP，正在启动托管监听（宿主关闭后自动退出）...")
                try spawnWatcherDirectly(installDir: installDir, cdpPort: opts.cdpPort, exitOnHostClose: true)
                result.watcherStarted = true
                shouldVerifyInjection = true
            } else {
                report(82, "托管启动模式：当前无 CDP 会话，不常驻任何后台进程")
                result.watcherStarted = false
            }
        }

        report(90, "正在检查 Antigravity Desktop 实时注入状态...")
        let watchLogPath = (installDir as NSString).appendingPathComponent("watch.log")

        if shouldVerifyInjection, let port = probePort {
            for attempt in 0..<15 {
                if let pages = try? CdpHelper.listPages(port: port) {
                    cdpReachable = true
                    let logContent = (try? String(contentsOfFile: watchLogPath, encoding: .utf8)) ?? ""
                    let pidExists = FileManager.default.fileExists(atPath: (installDir as NSString).appendingPathComponent(".watch.pid"))
                    let watcherInjected =
                        logContent.contains("[✓]") ||
                        logContent.contains("[↻]") ||
                        (pidExists && attempt >= 2)
                    if !pages.isEmpty && watcherInjected {
                        var allReady = true
                        var titles: [String] = []
                        for page in pages {
                            titles.append(CdpHelper.shortTitle(page))
                            do {
                                let session = try CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 2000)
                                defer { session.close() }
                                let okVal = try session.evaluate("Boolean(window.__agClaudeStudio)", awaitPromise: false)
                                if okVal.boolValue != true {
                                    allReady = false
                                }
                            } catch {
                                allReady = false
                            }
                        }
                        if allReady {
                            result.injectedPages = titles
                            break
                        }
                    }
                } else {
                    if !ag.isRunning && opts.cdpPort == nil && attempt >= 1 {
                        break
                    }
                }
                Thread.sleep(forTimeInterval: 0.35)
            }
        }
        result.cdpPort = cdpReachable ? probePort : nil

        result.ok = true
        if !result.injectedPages.isEmpty {
            result.headline = "修补成功！已实时注入 \(result.injectedPages.count) 个 Antigravity 窗口"
            result.detail = (runMode == "daemon")
                ? "常驻后台守护已运行并已配置登录自启。后续打开新窗口或更新 Antigravity 后也会自动注入。"
                : "已启用托管启动模式（当前临时监听将在 Antigravity 关闭后自动退出，平时 0 后台常驻）。之后直接打开「Antigravity (Claude Studio).app」启动即可。"
            for title in result.injectedPages {
                report(98, "已注入窗口: \(title)")
            }
        } else if cdpReachable, let port = probePort {
            result.headline = (runMode == "daemon")
                ? "已安装并启动守护！等待 Antigravity 窗口就绪"
                : "已安装并启动托管监听！等待 Antigravity 窗口就绪"
            result.detail = (runMode == "daemon")
                ? "已配置登录自启并启动后台守护。检测到调试端口 \(port)，窗口就绪后将自动完成注入。"
                : "检测到调试端口 \(port)，托管监听将在窗口就绪后自动注入，并在 Antigravity 关闭后自动退出。"
        } else if opts.cdpPort == nil && ag.isRunning {
            result.antigravityRunningWithoutCdp = true
            if runMode == "daemon" {
                result.headline = "已安装并启动守护！但当前 Antigravity 未开启 CDP 端口"
                result.detail = autoRelaunchEnabled
                    ? "Antigravity 2.33.0+ 默认关闭远程调试端口。后台守护已启用自动接管，将在数秒内尝试温和重启；也可点击下方「以 CDP 模式重启」立即生效。"
                    : "Antigravity 2.33.0+ 默认关闭远程调试端口。请点击下方「以 CDP 模式重启」，或退出后使用 --remote-debugging-port=0 启动即可生效。"
            } else {
                result.headline = "安装成功（托管模式）！当前 Antigravity 未开启 CDP 端口"
                result.detail = "托管模式下未常驻后台进程（0 后台占用）。请点击下方「以 CDP 模式重启」，或使用「Antigravity (Claude Studio).app」重启即可立即生效。"
            }
            report(95, "[!] 检测到 Antigravity 正在运行但未开启 CDP（2.33.0+ 需带参 --remote-debugging-port=0 启动）")
        } else {
            if runMode == "daemon" {
                result.headline = "安装成功！常驻后台守护已就绪"
                result.detail = "已配置 LaunchAgent 登录自启且守护进程在后台待命。如使用 Antigravity 2.33.0+，可通过启动器或 --remote-debugging-port=0 启动。"
            } else {
                result.headline = "安装成功！已启用托管启动模式（0 后台常驻）"
                result.detail = "未注册开机自启，平时无任何后台进程常驻。之后请通过「Antigravity (Claude Studio).app」或 launch-antigravity.command 启动 Antigravity。"
            }
        }
        report(100, result.headline)
        return result
    }

    static func runUninstall(opts: InstallerOptions, progress: ((Int, String) -> Void)?) -> OperationResult {
        let result = OperationResult()
        result.mode = "uninstall"
        let rawDir = (opts.installDir?.isEmpty == false) ? opts.installDir! : getDefaultInstallDir()
        let installDir = URL(fileURLWithPath: rawDir).standardizedFileURL.path
        result.installDir = installDir
        result.runMode = readInstalledMode(dir: installDir) ?? "managed"

        let report: (Int, String) -> Void = { pct, msg in
            progress?(pct, msg)
        }

        report(15, "正在停止后台守护进程...")
        stopWatcherInDir(installDir, noAutostart: opts.noAutostart) { msg in
            report(25, msg)
        }

        report(40, "正在通过 CDP 清理运行中的 Antigravity Desktop 界面...")
        let port = CdpHelper.readPort(overridePort: opts.cdpPort)
        result.cdpPort = port

        var removeExpr: String?
        if let m = try? PluginManifest.load(baseDir: installDir), !m.removeExpression.isEmpty {
            removeExpr = m.removeExpression
        } else if let payloadDir = resolvePayloadDir(),
                  let m = try? PluginManifest.load(baseDir: payloadDir),
                  !m.removeExpression.isEmpty {
            removeExpr = m.removeExpression
        }

        if let port = port, let expr = removeExpr, !expr.isEmpty,
           let pages = try? CdpHelper.listPages(port: port) {
            for page in pages {
                if let session = try? CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 3000) {
                    defer { session.close() }
                    if (try? session.evaluate(expr, awaitPromise: false)) != nil {
                        let title = CdpHelper.shortTitle(page)
                        result.injectedPages.append(title)
                        report(55, "已恢复原生界面: \(title)")
                    }
                }
            }
        }

        if !opts.noAutostart {
            report(70, "正在移除 LaunchAgent 登录自启项与启动器...")
            unloadLaunchAgent()
            let plistPath = getLaunchAgentPlistPath()
            if FileManager.default.fileExists(atPath: plistPath) {
                try? FileManager.default.removeItem(atPath: plistPath)
            }
            let appLauncherPath = getApplicationsLauncherAppPath()
            if FileManager.default.fileExists(atPath: appLauncherPath) {
                try? FileManager.default.removeItem(atPath: appLauncherPath)
            }
        }

        report(85, "正在清理安装目录: \(installDir)")
        if FileManager.default.fileExists(atPath: installDir) {
            try? FileManager.default.removeItem(atPath: installDir)
        }

        result.ok = true
        result.headline = "已卸载并恢复 Antigravity Desktop 原生界面"
        result.detail = !result.injectedPages.isEmpty
            ? "已停止守护、移除自启与启动器，并立即还原了 \(result.injectedPages.count) 个打开的窗口。"
            : "已停止守护、移除登录自启与启动器，并清理安装目录。"
        report(100, result.headline)
        return result
    }
}

final class FlippedView: NSView {
    override var isFlipped: Bool { return true }
}

final class InstallerAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let opts: InstallerOptions
    private var window: NSWindow!
    private var statusHeadline: NSTextField!
    private var statusDetail: NSTextField!
    private var metaLabel: NSTextField!
    private var managedRadio: NSButton!
    private var daemonRadio: NSButton!
    private var appLauncherCheck: NSButton!
    private var progressBar: NSProgressIndicator!
    private var logView: NSTextView!
    private var installBtn: NSButton!
    private var uninstallBtn: NSButton!
    private var openDirBtn: NSButton!
    private var launchAgBtn: NSButton!
    private var closeBtn: NSButton!

    private var activeInstallDir: String
    private var antigravityApp: String?
    private var needsCdpRelaunch = false
    private var busy = false

    init(opts: InstallerOptions) {
        self.opts = opts
        let rawDir = (opts.installDir?.isEmpty == false) ? opts.installDir! : InstallerCore.getDefaultInstallDir()
        self.activeInstallDir = URL(fileURLWithPath: rawDir).standardizedFileURL.path
        super.init()
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "退出 Claude Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    private static func srgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1.0) -> NSColor {
        return NSColor(srgbRed: r / 255.0, green: g / 255.0, blue: b / 255.0, alpha: a)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()

        let fm = FileManager.default
        let watcherBin = (activeInstallDir as NSString).appendingPathComponent(InstallerCore.watcherExeName)
        let alreadyInstalled = fm.fileExists(atPath: activeInstallDir) && fm.fileExists(atPath: watcherBin)
        let initialAg = InstallerCore.detectAntigravityDesktop()
        self.antigravityApp = initialAg.appPath
        let initialMode = InstallerCore.resolveRunMode(opts: opts, installDir: activeInstallDir)

        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 560),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        win.title = "Claude Studio 安装与修补工具"
        win.appearance = NSAppearance(named: .aqua)
        win.backgroundColor = Self.srgb(248, 246, 243)
        win.isReleasedWhenClosed = false
        win.delegate = self

        let root = FlippedView(frame: NSRect(x: 0, y: 0, width: 620, height: 560))
        win.contentView = root

        // Header
        let header = FlippedView(frame: NSRect(x: 0, y: 0, width: 620, height: 80))
        header.wantsLayer = true
        header.layer?.backgroundColor = Self.srgb(26, 25, 24).cgColor
        root.addSubview(header)

        let iconView = NSImageView(frame: NSRect(x: 20, y: 18, width: 44, height: 44))
        iconView.image = NSApp.applicationIconImage
        iconView.imageScaling = .scaleProportionallyUpOrDown
        header.addSubview(iconView)

        let titleLabel = NSTextField(labelWithString: "Claude Studio · 自动修补安装器")
        titleLabel.frame = NSRect(x: 76, y: 15, width: 524, height: 24)
        titleLabel.textColor = Self.srgb(250, 248, 245)
        titleLabel.font = NSFont.systemFont(ofSize: 17, weight: .bold)
        header.addSubview(titleLabel)

        let subtitleLabel = NSTextField(labelWithString: "Antigravity Desktop 无损实时界面增强、思考滑块与 Token HUD")
        subtitleLabel.frame = NSRect(x: 76, y: 45, width: 524, height: 18)
        subtitleLabel.textColor = Self.srgb(217, 119, 87)
        subtitleLabel.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        header.addSubview(subtitleLabel)

        // Status card
        let card = FlippedView(frame: NSRect(x: 20, y: 94, width: 580, height: 108))
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor.white.cgColor
        card.layer?.borderColor = Self.srgb(222, 217, 209).cgColor
        card.layer?.borderWidth = 1.0
        card.layer?.cornerRadius = 6.0
        root.addSubview(card)

        let readyHeadline = opts.uninstall
            ? "准备卸载并恢复原版界面..."
            : (alreadyInstalled
                ? "已检测到现有安装（当前模式：\(initialMode == "daemon" ? "常驻守护" : "托管启动")）"
                : "准备就绪 · 请选择运行模式后点击「开始安装」")
        statusHeadline = NSTextField(labelWithString: readyHeadline)
        statusHeadline.frame = NSRect(x: 14, y: 10, width: 552, height: 24)
        statusHeadline.textColor = Self.srgb(28, 25, 23)
        statusHeadline.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        statusHeadline.lineBreakMode = .byTruncatingTail
        card.addSubview(statusHeadline)

        let readyDetail = opts.uninstall
            ? "正在确认卸载操作，请稍候..."
            : "推荐使用「免后台常驻」托管启动模式：平时 0 后台进程，启动 Antigravity 时自动注入并在关闭后自动退出。"
        statusDetail = NSTextField(wrappingLabelWithString: readyDetail)
        statusDetail.frame = NSRect(x: 14, y: 38, width: 552, height: 40)
        statusDetail.textColor = Self.srgb(87, 83, 78)
        statusDetail.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        statusDetail.maximumNumberOfLines = 2
        card.addSubview(statusDetail)

        metaLabel = NSTextField(labelWithString: "安装路径: \(activeInstallDir)")
        metaLabel.frame = NSRect(x: 14, y: 82, width: 552, height: 18)
        metaLabel.textColor = Self.srgb(120, 113, 108)
        metaLabel.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        metaLabel.lineBreakMode = .byTruncatingMiddle
        card.addSubview(metaLabel)

        // Mode selection card
        let modeCard = FlippedView(frame: NSRect(x: 20, y: 212, width: 580, height: 106))
        modeCard.wantsLayer = true
        modeCard.layer?.backgroundColor = NSColor.white.cgColor
        modeCard.layer?.borderColor = Self.srgb(222, 217, 209).cgColor
        modeCard.layer?.borderWidth = 1.0
        modeCard.layer?.cornerRadius = 6.0
        root.addSubview(modeCard)

        let modeCardTitle = NSTextField(labelWithString: "运行模式选择（可随时重新运行切换）")
        modeCardTitle.frame = NSRect(x: 14, y: 10, width: 552, height: 18)
        modeCardTitle.textColor = Self.srgb(28, 25, 23)
        modeCardTitle.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        modeCard.addSubview(modeCardTitle)

        managedRadio = NSButton(
            radioButtonWithTitle: "免后台常驻 · 随 Antigravity 启动并自动退出（推荐）",
            target: self,
            action: #selector(handleModeRadioChanged(_:))
        )
        managedRadio.frame = NSRect(x: 14, y: 32, width: 552, height: 20)
        managedRadio.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        managedRadio.state = (initialMode == "daemon") ? .off : .on
        modeCard.addSubview(managedRadio)

        daemonRadio = NSButton(
            radioButtonWithTitle: "开机自启 · 后台常驻监听",
            target: self,
            action: #selector(handleModeRadioChanged(_:))
        )
        daemonRadio.frame = NSRect(x: 14, y: 54, width: 552, height: 20)
        daemonRadio.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        daemonRadio.state = (initialMode == "daemon") ? .on : .off
        modeCard.addSubview(daemonRadio)

        appLauncherCheck = NSButton(
            checkboxWithTitle: "在 ~/Applications 创建「Antigravity (Claude Studio).app」启动器",
            target: self,
            action: #selector(handleOptionChanged)
        )
        appLauncherCheck.frame = NSRect(x: 14, y: 78, width: 552, height: 20)
        appLauncherCheck.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        appLauncherCheck.state = (opts.createAppLauncher && !opts.noAppLauncher) ? .on : .off
        modeCard.addSubview(appLauncherCheck)

        // Progress bar
        progressBar = NSProgressIndicator(frame: NSRect(x: 20, y: 328, width: 580, height: 14))
        progressBar.isIndeterminate = false
        progressBar.minValue = 0
        progressBar.maxValue = 100
        progressBar.doubleValue = 0
        root.addSubview(progressBar)

        // Log area
        let scroll = NSScrollView(frame: NSRect(x: 20, y: 350, width: 580, height: 146))
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        let tv = NSTextView(frame: NSRect(x: 0, y: 0, width: 562, height: 142))
        tv.isEditable = false
        tv.isSelectable = true
        tv.backgroundColor = Self.srgb(252, 251, 249)
        tv.textColor = Self.srgb(41, 37, 36)
        tv.font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.textContainer?.widthTracksTextView = true
        scroll.documentView = tv
        root.addSubview(scroll)
        self.logView = tv

        // Buttons
        installBtn = NSButton(
            title: alreadyInstalled ? "应用模式 / 升级" : "开始安装",
            target: self,
            action: #selector(handleInstallClick)
        )
        installBtn.frame = NSRect(x: 20, y: 510, width: 122, height: 32)
        installBtn.bezelStyle = .rounded
        installBtn.keyEquivalent = "\r"
        installBtn.isEnabled = !opts.uninstall
        root.addSubview(installBtn)

        uninstallBtn = NSButton(title: "卸载并恢复原版", target: self, action: #selector(handleUninstallClick))
        uninstallBtn.frame = NSRect(x: 148, y: 510, width: 118, height: 32)
        uninstallBtn.bezelStyle = .rounded
        uninstallBtn.isEnabled = alreadyInstalled && !opts.uninstall
        root.addSubview(uninstallBtn)

        openDirBtn = NSButton(title: "打开配置目录", target: self, action: #selector(handleOpenDirClick))
        openDirBtn.frame = NSRect(x: 272, y: 510, width: 100, height: 32)
        openDirBtn.bezelStyle = .rounded
        openDirBtn.isEnabled = fm.fileExists(atPath: activeInstallDir) && !opts.uninstall
        root.addSubview(openDirBtn)

        launchAgBtn = NSButton(title: "启动 Antigravity", target: self, action: #selector(handleLaunchAgClick))
        launchAgBtn.frame = NSRect(x: 378, y: 510, width: 124, height: 32)
        launchAgBtn.bezelStyle = .rounded
        let showInitialLaunch = alreadyInstalled && initialAg.appPath != nil && !opts.uninstall
        launchAgBtn.isHidden = !showInitialLaunch
        launchAgBtn.isEnabled = showInitialLaunch
        root.addSubview(launchAgBtn)

        closeBtn = NSButton(title: "关闭", target: self, action: #selector(handleCloseClick))
        closeBtn.frame = NSRect(x: 508, y: 510, width: 92, height: 32)
        closeBtn.bezelStyle = .rounded
        closeBtn.isEnabled = !opts.uninstall
        root.addSubview(closeBtn)

        win.center()
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = win

        if opts.uninstall {
            setModeControlsEnabled(false)
            startInitialAction()
        } else {
            appendLog("[*] 当前配置目录: \(activeInstallDir)")
            appendLog("[*] 默认模式: \(initialMode == "daemon" ? "常驻守护模式 (daemon)" : "托管启动模式 (managed · 0 后台常驻)")")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        return !busy
    }

    private func appendLog(_ msg: String) {
        let df = DateFormatter()
        df.dateFormat = "HH:mm:ss"
        let line = "[\(df.string(from: Date()))] \(msg)\n"
        DispatchQueue.main.async {
            let attr = NSAttributedString(
                string: line,
                attributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular),
                    .foregroundColor: Self.srgb(41, 37, 36),
                ]
            )
            self.logView.textStorage?.append(attr)
            self.logView.scrollToEndOfDocument(nil)
        }
    }

    private func updateProgress(_ pct: Int, _ msg: String) {
        let clamped = Double(max(0, min(100, pct)))
        DispatchQueue.main.async {
            self.progressBar.doubleValue = clamped
        }
        appendLog(msg)
    }

    private func setButtonsEnabled(_ enabled: Bool) {
        installBtn.isEnabled = enabled
        uninstallBtn.isEnabled = enabled
        openDirBtn.isEnabled = enabled
        launchAgBtn.isEnabled = enabled
        closeBtn.isEnabled = enabled
    }

    private func setModeControlsEnabled(_ enabled: Bool) {
        managedRadio.isEnabled = enabled
        daemonRadio.isEnabled = enabled
        appLauncherCheck.isEnabled = enabled
    }

    @objc private func handleModeRadioChanged(_ sender: NSButton) {
        if sender === managedRadio {
            managedRadio.state = .on
            daemonRadio.state = .off
        } else {
            managedRadio.state = .off
            daemonRadio.state = .on
        }
        if !busy {
            installBtn.isEnabled = true
            installBtn.keyEquivalent = "\r"
            closeBtn.keyEquivalent = ""
        }
    }

    @objc private func handleOptionChanged() {
        if !busy {
            installBtn.isEnabled = true
            installBtn.keyEquivalent = "\r"
            closeBtn.keyEquivalent = ""
        }
    }

    @objc private func handleInstallClick() {
        guard !busy else { return }
        opts.runMode = (daemonRadio.state == .on) ? "daemon" : "managed"
        opts.modeExplicit = true
        let wantLauncher = (appLauncherCheck.state == .on)
        opts.createAppLauncher = wantLauncher
        opts.noAppLauncher = !wantLauncher
        executeInstall()
    }

    private func startInitialAction() {
        if opts.uninstall {
            let alert = NSAlert()
            alert.messageText = "卸载确认"
            alert.informativeText = "确认要卸载 Claude Studio 并恢复 Antigravity Desktop 原生界面吗？"
            alert.alertStyle = .informational
            alert.addButton(withTitle: "确认卸载")
            alert.addButton(withTitle: "取消")
            if alert.runModal() == .alertFirstButtonReturn {
                executeUninstall()
            } else {
                window.close()
            }
        }
    }

    private func executeInstall() {
        busy = true
        setButtonsEnabled(false)
        setModeControlsEnabled(false)
        progressBar.doubleValue = 5
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let res = try InstallerCore.runInstall(opts: self.opts) { pct, msg in
                    self.updateProgress(pct, msg)
                }
                DispatchQueue.main.async {
                    self.activeInstallDir = res.installDir
                    self.antigravityApp = res.antigravityApp
                    self.needsCdpRelaunch = res.antigravityRunningWithoutCdp
                    self.statusHeadline.stringValue = res.headline
                    self.statusHeadline.textColor = res.antigravityRunningWithoutCdp ? Self.srgb(180, 83, 9) : Self.srgb(21, 128, 61)
                    self.statusDetail.stringValue = res.detail
                    let modeText = (res.runMode == "daemon") ? "常驻守护" : "托管启动"
                    self.metaLabel.stringValue = "模式: \(modeText) | \(res.configSummary)"
                    self.installBtn.title = "应用模式 / 升级"
                    self.installBtn.isEnabled = true
                    self.installBtn.keyEquivalent = ""
                    self.openDirBtn.isEnabled = FileManager.default.fileExists(atPath: self.activeInstallDir)
                    self.uninstallBtn.isEnabled = true
                    let showLaunch = (self.antigravityApp != nil && res.injectedPages.isEmpty)
                    self.launchAgBtn.title = res.antigravityRunningWithoutCdp ? "以 CDP 模式重启" : "以 CDP 模式启动"
                    self.launchAgBtn.isHidden = !showLaunch
                    self.launchAgBtn.isEnabled = showLaunch
                    self.closeBtn.title = "完成并关闭"
                    self.closeBtn.keyEquivalent = "\r"
                    self.closeBtn.isEnabled = true
                    self.setModeControlsEnabled(true)
                    self.busy = false
                }
            } catch {
                self.appendLog("[✗] 错误: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.statusHeadline.stringValue = "修补失败"
                    self.statusHeadline.textColor = Self.srgb(185, 28, 28)
                    self.statusDetail.stringValue = error.localizedDescription
                    self.installBtn.isEnabled = true
                    self.setModeControlsEnabled(true)
                    self.busy = false
                    self.closeBtn.isEnabled = true
                }
            }
        }
    }

    @objc private func handleUninstallClick() {
        let alert = NSAlert()
        alert.messageText = "卸载并恢复原版"
        alert.informativeText = "确认卸载 Claude Studio、停止后台守护并立即恢复 Antigravity 原生界面？"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确认卸载")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn {
            executeUninstall()
        }
    }

    private func executeUninstall() {
        busy = true
        setButtonsEnabled(false)
        setModeControlsEnabled(false)
        DispatchQueue.global(qos: .userInitiated).async {
            let res = InstallerCore.runUninstall(opts: self.opts) { pct, msg in
                self.updateProgress(pct, msg)
            }
            DispatchQueue.main.async {
                self.statusHeadline.stringValue = res.headline
                self.statusHeadline.textColor = Self.srgb(3, 105, 161)
                self.statusDetail.stringValue = res.detail
                self.metaLabel.stringValue = "已清理目录: \(res.installDir)"
                self.installBtn.title = "开始安装"
                self.installBtn.isEnabled = true
                self.installBtn.keyEquivalent = ""
                self.openDirBtn.isEnabled = false
                self.uninstallBtn.isEnabled = false
                self.launchAgBtn.isHidden = true
                self.closeBtn.title = "完成并关闭"
                self.closeBtn.keyEquivalent = "\r"
                self.closeBtn.isEnabled = true
                self.setModeControlsEnabled(true)
                self.busy = false
            }
        }
    }

    @objc private func handleOpenDirClick() {
        if FileManager.default.fileExists(atPath: activeInstallDir) {
            NSWorkspace.shared.open(URL(fileURLWithPath: activeInstallDir))
        }
    }

    @objc private func handleLaunchAgClick() {
        let watcherExe = (activeInstallDir as NSString).appendingPathComponent(InstallerCore.watcherExeName)
        guard FileManager.default.fileExists(atPath: watcherExe) else {
            appendLog("[!] 未找到监听程序: \(watcherExe)")
            return
        }
        var args = ["--launch"]
        let hadRelaunch = needsCdpRelaunch
        if hadRelaunch {
            args.append("--relaunch")
        }
        args.append("--exit-on-host-close")
        args.append("--dir")
        args.append(activeInstallDir)
        if let port = opts.cdpPort, port > 0 {
            args.append("--cdp-port")
            args.append(String(port))
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: watcherExe)
        proc.arguments = args
        proc.currentDirectoryURL = URL(fileURLWithPath: activeInstallDir)
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
            needsCdpRelaunch = false
            launchAgBtn.isEnabled = false
            statusHeadline.stringValue = hadRelaunch
                ? "已启动托管重启流程（CDP + 自动退出监听）"
                : "已通过托管启动器拉起 Antigravity"
            statusHeadline.textColor = Self.srgb(21, 128, 61)
            statusDetail.stringValue = "Antigravity 将以 CDP 模式启动并自动注入；关闭所有 Antigravity 窗口后监听进程将自动退出。"
            appendLog(hadRelaunch
                ? "[✓] 已拉起托管重启与自动注入监听 (--launch --relaunch --exit-on-host-close)"
                : "[✓] 已拉起托管启动与自动注入监听 (--launch --exit-on-host-close)")
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(2)) { [weak self] in
                guard let self = self, !self.launchAgBtn.isHidden else { return }
                self.launchAgBtn.isEnabled = true
            }
        } catch {
            appendLog("[!] 启动托管监听进程失败: \(error.localizedDescription)")
        }
    }

    @objc private func handleCloseClick() {
        window.close()
    }
}

func parseInstallerArgs(_ args: [String]) -> InstallerOptions {
    let opts = InstallerOptions()
    var i = 1
    while i < args.count {
        let a = args[i]
        if a.hasPrefix("-psn_") {
            i += 1
            continue
        }
        if a == "--uninstall" { opts.uninstall = true }
        else if a == "--silent" || a == "/S" || a == "-s" { opts.silent = true }
        else if a == "--popup" { opts.popup = true }
        else if a == "--status" { opts.statusOnly = true }
        else if a == "--no-autostart" { opts.noAutostart = true }
        else if a == "--no-kill-legacy" { opts.noKillLegacy = true }
        else if a == "--managed" {
            opts.runMode = "managed"
            opts.modeExplicit = true
        }
        else if a == "--daemon" {
            opts.runMode = "daemon"
            opts.modeExplicit = true
        }
        else if a == "--mode" && i + 1 < args.count {
            i += 1
            let val = args[i].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if val == "managed" || val == "daemon" {
                opts.runMode = val
                opts.modeExplicit = true
            }
        }
        else if a.hasPrefix("--mode=") {
            let val = String(a.dropFirst("--mode=".count)).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if val == "managed" || val == "daemon" {
                opts.runMode = val
                opts.modeExplicit = true
            }
        }
        else if a == "--app-launcher" {
            opts.createAppLauncher = true
            opts.noAppLauncher = false
        }
        else if a == "--no-app-launcher" {
            opts.createAppLauncher = false
            opts.noAppLauncher = true
        }
        else if a == "--install-dir" && i + 1 < args.count { i += 1; opts.installDir = args[i] }
        else if a == "--cdp-port" && i + 1 < args.count {
            i += 1
            if let p = Int(args[i]), p > 0 { opts.cdpPort = p }
        }
        else if a == "--out" && i + 1 < args.count { i += 1; opts.outFile = args[i] }
        i += 1
    }
    return opts
}

func writeOperationOutFile(_ outFile: String?, res: OperationResult) {
    guard let outFile = outFile, !outFile.isEmpty else { return }
    let d: [String: JsonValue] = [
        "ok": .bool(res.ok),
        "mode": .string(res.mode),
        "runMode": .string(res.runMode),
        "headline": .string(res.headline),
        "detail": .string(res.detail),
        "installDir": .string(res.installDir),
        "antigravityApp": res.antigravityApp.map { .string($0) } ?? .null,
        "antigravityVersion": res.antigravityVersion.map { .string($0) } ?? .null,
        "antigravityRunningWithoutCdp": .bool(res.antigravityRunningWithoutCdp),
        "cdpPort": res.cdpPort.map { .int(Int64($0)) } ?? .null,
        "injectedPages": .array(res.injectedPages.map { .string($0) }),
        "preservedExistingConfig": .bool(res.preservedExistingConfig),
        "watcherStarted": .bool(res.watcherStarted),
        "launchAgent": .bool(res.launchAgentActive),
        "launcherApp": res.launcherAppPath.map { .string($0) } ?? .null,
    ]
    let text = MiniJson.stringify(.object(d), pretty: true) + "\n"
    try? text.write(toFile: outFile, atomically: true, encoding: .utf8)
}

func runInstallerMain() -> Int32 {
    let opts = parseInstallerArgs(CommandLine.arguments)

    if opts.statusOnly {
        let rawDir = (opts.installDir?.isEmpty == false) ? opts.installDir! : InstallerCore.getDefaultInstallDir()
        let dir = URL(fileURLWithPath: rawDir).standardizedFileURL.path
        let ag = InstallerCore.detectAntigravityDesktop()
        let port = CdpHelper.readPort(overridePort: opts.cdpPort)
        let watcherPath = (dir as NSString).appendingPathComponent(InstallerCore.watcherExeName)
        let fm = FileManager.default
        let installedMode = InstallerCore.readInstalledMode(dir: dir)
        let launchAgentExists = fm.fileExists(atPath: InstallerCore.getLaunchAgentPlistPath())
        let launcherAppExists = fm.fileExists(atPath: InstallerCore.getApplicationsLauncherAppPath())
        let pidFile = (dir as NSString).appendingPathComponent(".watch.pid")
        var watcherRunning = false
        if let pidStr = try? String(contentsOfFile: pidFile, encoding: .utf8),
           let pid = Int32(pidStr.trimmingCharacters(in: .whitespacesAndNewlines)),
           CdpHelper.isProcessAlive(pid) {
            watcherRunning = true
        }
        let resolvedMode = installedMode ?? (launchAgentExists ? "daemon" : "managed")
        let st: [String: JsonValue] = [
            "installed": .bool(fm.fileExists(atPath: dir) && fm.fileExists(atPath: watcherPath)),
            "installDir": .string(dir),
            "installedMode": installedMode.map { .string($0) } ?? .null,
            "runMode": .string(resolvedMode),
            "watcherStarted": .bool(watcherRunning),
            "launchAgent": .bool(launchAgentExists),
            "launcherApp": .bool(launcherAppExists),
            "antigravityApp": ag.appPath.map { .string($0) } ?? .null,
            "antigravityVersion": ag.version.map { .string($0) } ?? .null,
            "antigravityRunning": .bool(ag.isRunning),
            "cdpPort": port.map { .int(Int64($0)) } ?? .null,
        ]
        let json = MiniJson.stringify(.object(st), pretty: true) + "\n"
        if let outFile = opts.outFile, !outFile.isEmpty {
            try? json.write(toFile: outFile, atomically: true, encoding: .utf8)
        } else {
            print(json, terminator: "")
        }
        return 0
    }

    if opts.silent {
        do {
            let res = opts.uninstall
                ? InstallerCore.runUninstall(opts: opts, progress: nil)
                : try InstallerCore.runInstall(opts: opts, progress: nil)
            writeOperationOutFile(opts.outFile, res: res)
            if opts.popup {
                let app = NSApplication.shared
                app.setActivationPolicy(.accessory)
                let alert = NSAlert()
                alert.messageText = res.headline
                alert.informativeText = res.detail
                alert.runModal()
            }
            return res.ok ? 0 : 1
        } catch {
            if let outFile = opts.outFile, !outFile.isEmpty {
                let errObj: [String: JsonValue] = [
                    "ok": .bool(false),
                    "error": .string(error.localizedDescription),
                ]
                let text = MiniJson.stringify(.object(errObj), pretty: true) + "\n"
                try? text.write(toFile: outFile, atomically: true, encoding: .utf8)
            }
            if opts.popup {
                let app = NSApplication.shared
                app.setActivationPolicy(.accessory)
                let alert = NSAlert()
                alert.alertStyle = .critical
                alert.messageText = "Claude Studio 操作失败"
                alert.informativeText = error.localizedDescription
                alert.runModal()
            }
            return 1
        }
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let delegate = InstallerAppDelegate(opts: opts)
    app.delegate = delegate
    app.run()
    return 0
}

exit(runInstallerMain())
