import Foundation
import AppKit
#if canImport(Darwin)
import Darwin
#endif

final class AttachedEntry {
    let scriptLock = NSLock()
    let session: CdpSession
    var bootstrapScriptId: String?
    var configScriptId: String?
    let title: String

    init(session: CdpSession, bootstrapScriptId: String? = nil, configScriptId: String? = nil, title: String) {
        self.session = session
        self.bootstrapScriptId = bootstrapScriptId
        self.configScriptId = configScriptId
        self.title = title
    }
}

// CDP events arrive on the receive loop; frame-tree queries must run off that loop.
private final class BindingSource {
    private final class World { let frame: String; init(_ frame: String) { self.frame = frame } }
    private let lock = NSLock()
    private var worlds: [Int: World] = [:]

    init(_ session: CdpSession) {
        session.on("Runtime.executionContextCreated") { p in
            guard let c = p["context"]?.objectValue, let id = c["id"]?.intValue else { return }
            let aux = c["auxData"]?.objectValue
            self.lock.lock(); defer { self.lock.unlock() }
            self.worlds[id] = nil
            if aux?["isDefault"]?.boolValue == true, let frame = aux?["frameId"]?.stringValue { self.worlds[id] = World(frame) }
        }
        session.on("Runtime.executionContextDestroyed") { p in
            guard let id = p["executionContextId"]?.intValue else { return }
            self.lock.lock(); defer { self.lock.unlock() }; self.worlds[id] = nil
        }
        session.on("Runtime.executionContextsCleared") { _ in self.lock.lock(); self.worlds.removeAll(); self.lock.unlock() }
    }

    func verify(_ id: Int, _ page: CdpPageInfo, _ session: CdpSession, fileAction: Bool) -> Bool {
        lock.lock(); let world = worlds[id]; lock.unlock()
        guard let current = world, CdpHelper.isHostPage(page, url: page.url),
              let tree = try? session.send("Page.getFrameTree", timeoutMs: 3000),
              let frame = tree["frameTree"]?.objectValue?["frame"]?.objectValue,
              frame["parentId"] == nil, frame["id"]?.stringValue == current.frame,
              let url = frame["url"]?.stringValue,
              (fileAction ? CdpHelper.isFileActionDocument(page, url: url) : CdpHelper.isHostPage(page, url: url)) else { return false }
        lock.lock(); defer { lock.unlock() }; return worlds[id] === current
    }
}

final class WatcherApp {
    private let hostConfigLock = NSLock()
    private var lastHostEnabled = false

    private func hostEnabled() -> Bool {
        hostConfigLock.lock()
        defer { hostConfigLock.unlock() }
        let env = ProcessInfo.processInfo.environment
        let override = [env["AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG"], env["AGY_CLAUDE_STYLE_ANTIGRAVITY_CONFIG"]]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty }
        let path = override ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".gemini/config/config.json").path
        do {
            let raw = try String(contentsOfFile: path, encoding: .utf8)
            let cfg = try MiniJson.parseObject(raw.hasPrefix("\u{feff}") ? String(raw.dropFirst()) : raw)
            lastHostEnabled = cfg["plugins"]?.objectValue?["agy-claude-studio"]?.objectValue?["enabled"]?.boolValue != false
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
            lastHostEnabled = true
        } catch { /* retain the last decision during partial writes */ }
        return lastHostEnabled
    }
    private let baseDir: String
    private let logFile: String
    private let pidFile: String
    private let lockFile: String
    private let isWatch: Bool
    private let pollMs: Int
    private let logLock = NSLock()

    private func handleFileLinkAction(_ raw: String, mode: String) -> Bool {
        guard raw.utf8.count <= 4096, mode == "open" || mode == "reveal",
              raw.lowercased().hasPrefix("file:///"), !raw.lowercased().hasPrefix("file:////"),
              !raw.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || $0 == "\"" }),
              let url = URL(string: raw), url.isFileURL,
              url.host == nil || url.host == "",
              !url.path.hasPrefix("//") else { return false }
        let resolvedURL = URL(fileURLWithPath: url.path).resolvingSymlinksInPath().standardizedFileURL
        let path = resolvedURL.path
        guard !path.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || $0 == "\"" }) else { return false }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else { return false }
        let packages: Set<String> = ["app", "pkg", "mpkg", "prefpane", "workflow", "action", "saver", "plugin", "scptd", "appex", "bundle", "framework"]
        let allowed: Set<String> = ["html", "htm", "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "wav", "mp3", "m4a", "flac", "ogg", "mp4", "mov", "mkv", "webm", "txt", "md", "markdown", "json", "yaml", "yml", "toml", "csv", "tsv", "xml", "log", "ini", "cfg", "conf", "css", "sql", "diff", "patch", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "tar", "gz", "7z"]
        let ext = resolvedURL.pathExtension.lowercased()

        if mode == "open" {
            guard let values = try? resolvedURL.resourceValues(forKeys: [.isAliasFileKey, .isRegularFileKey]), values.isAliasFile == false else { return false }
            if isDirectory.boolValue {
                if packages.contains(ext) || NSWorkspace.shared.isFilePackage(atPath: path) { return false }
            } else if values.isRegularFile != true || !allowed.contains(ext) { return false }
        }
        if mode == "open" { return NSWorkspace.shared.open(resolvedURL) }
        NSWorkspace.shared.activateFileViewerSelecting([resolvedURL])
        return true
    }

    init(baseDir: String, isWatch: Bool, pollMs: Int = 2000) {
        self.baseDir = baseDir
        self.logFile = (baseDir as NSString).appendingPathComponent("watch.log")
        self.pidFile = (baseDir as NSString).appendingPathComponent(".watch.pid")
        self.lockFile = (baseDir as NSString).appendingPathComponent(".watch.lock")
        self.isWatch = isWatch
        self.pollMs = max(100, min(10000, pollMs))
    }

    func log(_ line: String) {
        guard isWatch else { return }
        logLock.lock()
        defer { logLock.unlock() }
        let fm = FileManager.default
        if let attrs = try? fm.attributesOfItem(atPath: logFile),
           let size = attrs[.size] as? NSNumber,
           size.int64Value > 1024 * 1024 {
            try? "".write(toFile: logFile, atomically: false, encoding: .utf8)
        }
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let entry = "[\(fmt.string(from: Date()))] \(line)\n"
        guard let data = entry.data(using: .utf8) else { return }
        if !fm.fileExists(atPath: logFile) {
            fm.createFile(atPath: logFile, contents: data, attributes: nil)
            return
        }
        if let handle = FileHandle(forWritingAtPath: logFile) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        }
    }

    static func writeResult(outFile: String?, ok: Bool, message: String, pages: [String]?) {
        guard let outFile = outFile, !outFile.isEmpty else { return }
        var obj: [String: JsonValue] = [
            "ok": .bool(ok),
            "message": .string(message)
        ]
        if let pages = pages {
            obj["pages"] = .array(pages.map { .string($0) })
        }
        let text = MiniJson.stringify(.object(obj), pretty: true) + "\n"
        try? text.write(toFile: outFile, atomically: true, encoding: .utf8)
    }

    private func readPidFile() -> Int32? {
        guard let text = try? String(contentsOfFile: pidFile, encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let pid = Int32(trimmed), pid > 0 { return pid }
        return nil
    }

    private func releasePidFile(selfPid: Int32) {
        if let current = readPidFile(), current == selfPid {
            try? FileManager.default.removeItem(atPath: pidFile)
        }
    }

    func runOnce(overridePort: Int?, outFile: String?) -> Int32 {
        guard hostEnabled() else {
            Self.writeResult(outFile: outFile, ok: true, message: "plugin disabled", pages: [])
            return 0
        }
        do {
            let manifest = try PluginManifest.load(baseDir: baseDir)
            guard let port = CdpHelper.readPort(overridePort: overridePort) else {
                let running = !CdpHelper.detectAntigravityProcessPids().isEmpty
                Self.writeResult(outFile: outFile, ok: false, message: CdpHelper.cdpUnavailableMessage(running: running, port: nil), pages: nil)
                return 1
            }
            let pages: [CdpPageInfo]
            do {
                pages = try CdpHelper.listPages(port: port)
            } catch {
                let running = !CdpHelper.detectAntigravityProcessPids().isEmpty
                Self.writeResult(outFile: outFile, ok: false, message: CdpHelper.cdpUnavailableMessage(running: running, port: port), pages: nil)
                return 1
            }
            if pages.isEmpty {
                Self.writeResult(outFile: outFile, ok: false, message: "未找到 Antigravity 窗口页面", pages: nil)
                return 1
            }
            let expr = try CdpHelper.buildInjectExpression(baseDir: baseDir, manifest: manifest)
            var injectedTitles: [String] = []
            for page in pages {
                let session = try CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 4000)
                defer { session.close() }
                guard hostEnabled() else { break }
                _ = try session.evaluate(expr, awaitPromise: false)
                injectedTitles.append(CdpHelper.shortTitle(page))
            }
            Self.writeResult(outFile: outFile, ok: true, message: "injected \(injectedTitles.count) page(s)", pages: injectedTitles)
            return 0
        } catch {
            Self.writeResult(outFile: outFile, ok: false, message: error.localizedDescription, pages: nil)
            return 1
        }
    }

    func runRemove(overridePort: Int?, outFile: String?) -> Int32 {
        let manifest = try? PluginManifest.load(baseDir: baseDir)
        stopRunningWatcherInDir()
        var cleaned: [String] = []
        if let port = CdpHelper.readPort(overridePort: overridePort),
           let removeExpr = manifest?.removeExpression,
           !removeExpr.isEmpty,
           let pages = try? CdpHelper.listPages(port: port) {
            for page in pages {
                if let session = try? CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 3000) {
                    defer { session.close() }
                    if (try? session.evaluate(removeExpr, awaitPromise: false)) != nil {
                        cleaned.append(CdpHelper.shortTitle(page))
                    }
                }
            }
        }
        Self.writeResult(outFile: outFile, ok: true, message: "removed from \(cleaned.count) page(s)", pages: cleaned)
        return 0
    }

    private func stopRunningWatcherInDir() {
        let selfPid = getpid()
        guard let pid = readPidFile(), pid != selfPid else {
            try? FileManager.default.removeItem(atPath: pidFile)
            return
        }
        let cls = CdpHelper.classifyWatcherPid(pid, baseDir: baseDir)
        switch cls.status {
        case .unknown:
            // Fail closed: never kill or delete .watch.pid when ownership cannot be verified.
            return
        case .dead, .foreign:
            try? FileManager.default.removeItem(atPath: pidFile)
            return
        case .owned:
            if kill(pid, 0) == 0 {
                _ = kill(pid, SIGTERM)
                let deadline = Date().addingTimeInterval(2.0)
                while Date() < deadline {
                    if kill(pid, 0) != 0 { break }
                    Thread.sleep(forTimeInterval: 0.05)
                }
                if kill(pid, 0) == 0 {
                    _ = kill(pid, SIGKILL)
                    Thread.sleep(forTimeInterval: 0.1)
                }
            }
            try? FileManager.default.removeItem(atPath: pidFile)
        }
    }

    private func computeDirStamp() -> [String: String] {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: baseDir) else { return [:] }
        var stamp: [String: String] = [:]
        for name in names {
            if name.hasPrefix(".") { continue }
            let lower = name.lowercased()
            if !lower.hasSuffix(".css") && !lower.hasSuffix(".js") && !lower.hasSuffix(".json") {
                continue
            }
            let full = (baseDir as NSString).appendingPathComponent(name)
            if let attrs = try? fm.attributesOfItem(atPath: full) {
                let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
                stamp[name] = "\(mtime):\(size)"
            }
        }
        return stamp
    }

    private func firstChangedFile(oldStamp: [String: String], newStamp: [String: String]) -> String? {
        for (k, v) in newStamp {
            if oldStamp[k] != v { return k }
        }
        for k in oldStamp.keys where newStamp[k] == nil {
            return k
        }
        return nil
    }

    func runWatch(
        overridePort: Int?,
        exitOnHostCloseFlag: Bool = false,
        parentPid: Int32? = nil,
        startupGraceEnabled: Bool = false,
        startupGraceSeconds: Double = CdpHelper.defaultStartupGraceSeconds,
        replaceExisting: Bool = false,
        waitBrieflyForLock: Bool = false,
        initialLog: String? = nil
    ) -> Int32 {
        try? FileManager.default.createDirectory(atPath: baseDir, withIntermediateDirectories: true, attributes: nil)
        if replaceExisting {
            stopRunningWatcherInDir()
        }
        let lockFd = open(lockFile, O_CREAT | O_RDWR, 0o644)
        if lockFd < 0 {
            return 1
        }
        var locked = (flock(lockFd, LOCK_EX | LOCK_NB) == 0)
        if !locked && waitBrieflyForLock {
            let lockDeadline = Date().addingTimeInterval(1.5)
            while Date() < lockDeadline {
                Thread.sleep(forTimeInterval: 0.1)
                if flock(lockFd, LOCK_EX | LOCK_NB) == 0 {
                    locked = true
                    break
                }
            }
        }
        if !locked {
            close(lockFd)
            return 0
        }

        let selfPid = getpid()
        if let existingPid = readPidFile(), existingPid != selfPid {
            let cls = CdpHelper.classifyWatcherPid(existingPid, baseDir: baseDir)
            if cls.status == .unknown {
                log("[!] 无法验证 .watch.pid 进程归属 (PID \(existingPid))，出于安全策略拒绝覆盖锁文件")
                flock(lockFd, LOCK_UN)
                close(lockFd)
                return 1
            }
            if cls.status == .owned {
                log("[*] 检测到同目录守护进程已在运行 (PID \(existingPid))，退出重复实例")
                flock(lockFd, LOCK_UN)
                close(lockFd)
                return 0
            }
        }
        try? String(selfPid).write(toFile: pidFile, atomically: true, encoding: .utf8)
        try? "".write(toFile: logFile, atomically: false, encoding: .utf8)

        var manifest: PluginManifest
        var currentExpr: String
        var currentConfigExpr: String
        var currentCodeHash: String
        var currentCssHash: String
        var cfgAutoRelaunch = true
        var cfgExitOnHostClose = false
        do {
            manifest = try PluginManifest.load(baseDir: baseDir)
            let initCfg = CdpHelper.readConfig(baseDir: baseDir, manifest: manifest)
            cfgAutoRelaunch = initCfg["autoRelaunchWithCdp"]?.boolValue ?? true
            cfgExitOnHostClose = initCfg["exitOnHostClose"]?.boolValue ?? false
            let hashes = try CdpHelper.readBundleAndCssHashes(baseDir: baseDir, manifest: manifest)
            currentCodeHash = hashes.codeHash
            currentCssHash = hashes.cssHash
            currentExpr = try CdpHelper.buildInjectExpression(baseDir: baseDir, manifest: manifest)
            currentConfigExpr = CdpHelper.buildConfigScriptExpression(baseDir: baseDir, manifest: manifest, expectedCodeHash: currentCodeHash)
        } catch {
            log("[!] 初始化加载失败: \(error.localizedDescription)")
            releasePidFile(selfPid: selfPid)
            flock(lockFd, LOCK_UN)
            close(lockFd)
            return 1
        }

        let modeLabel = exitOnHostCloseFlag ? "托管监听模式" : "守护模式"
        log("[*] Claude Studio (agy-claude-studio) \(modeLabel)启动 (PID \(selfPid))，轮询间隔 \(pollMs)ms")
        if let initialLog = initialLog, !initialLog.isEmpty {
            log(initialLog)
        }

        let stateLock = NSLock()
        var attached: [String: AttachedEntry] = [:]
        var attaching: Set<String> = []
        var hadAttachedWindow = false
        var lastDirStamp = computeDirStamp()

        let exitSem = DispatchSemaphore(value: 0)
        var shouldExit = false
        let exitLock = NSLock()
        let requestExit = {
            exitLock.lock()
            let already = shouldExit
            shouldExit = true
            exitLock.unlock()
            if !already {
                exitSem.signal()
            }
        }
        let isExiting: () -> Bool = {
            exitLock.lock()
            let v = shouldExit
            exitLock.unlock()
            return v
        }

        signal(SIGTERM, SIG_IGN)
        signal(SIGINT, SIG_IGN)
        let sigQueue = DispatchQueue(label: "io.github.eosglyph.agy-claude-studio.signals")
        let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: sigQueue)
        termSource.setEventHandler(handler: requestExit)
        termSource.resume()
        let intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: sigQueue)
        intSource.setEventHandler(handler: requestExit)
        intSource.resume()

        let applyToEntry: (AttachedEntry, String, String, Bool) throws -> JsonValue = { entry, fullExprToUse, configExprToUse, refreshOnly in
            entry.scriptLock.lock()
            defer { entry.scriptLock.unlock() }
            guard self.hostEnabled() else { throw NSError(domain: "Watcher", code: NSUserCancelledError) }
            if refreshOnly, let _ = entry.bootstrapScriptId, !configExprToUse.isEmpty {
                if let oldCfgId = entry.configScriptId, !oldCfgId.isEmpty {
                    _ = try? entry.session.send(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        params: ["identifier": .string(oldCfgId)],
                        timeoutMs: 5000
                    )
                    entry.configScriptId = nil
                }
                let addCfgRes = try entry.session.send(
                    "Page.addScriptToEvaluateOnNewDocument",
                    params: ["source": .string(configExprToUse)],
                    timeoutMs: 15000
                )
                if let newCfgId = addCfgRes["identifier"]?.stringValue {
                    entry.configScriptId = newCfgId
                }
                if let fastVal = try? entry.session.evaluate(configExprToUse, awaitPromise: false),
                   fastVal.objectValue?["status"]?.stringValue == "refreshed" {
                    return fastVal
                }
            }

            if let oldCfgId = entry.configScriptId, !oldCfgId.isEmpty {
                _ = try? entry.session.send(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    params: ["identifier": .string(oldCfgId)],
                    timeoutMs: 5000
                )
                entry.configScriptId = nil
            }
            if let oldBootId = entry.bootstrapScriptId, !oldBootId.isEmpty {
                _ = try? entry.session.send(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    params: ["identifier": .string(oldBootId)],
                    timeoutMs: 5000
                )
                entry.bootstrapScriptId = nil
            }
            let addBootRes = try entry.session.send(
                "Page.addScriptToEvaluateOnNewDocument",
                params: ["source": .string(fullExprToUse)],
                timeoutMs: 15000
            )
            if let newBootId = addBootRes["identifier"]?.stringValue {
                entry.bootstrapScriptId = newBootId
            }
            if !configExprToUse.isEmpty {
                let addCfgRes = try entry.session.send(
                    "Page.addScriptToEvaluateOnNewDocument",
                    params: ["source": .string(configExprToUse)],
                    timeoutMs: 15000
                )
                if let newCfgId = addCfgRes["identifier"]?.stringValue {
                    entry.configScriptId = newCfgId
                }
                _ = try? entry.session.evaluate(configExprToUse, awaitPromise: false)
            }
            return try entry.session.evaluate(fullExprToUse, awaitPromise: false)
        }

        let attachPage: (CdpPageInfo) -> Void = { page in
            stateLock.lock()
            if attached[page.id] != nil || attaching.contains(page.id) {
                stateLock.unlock()
                return
            }
            attaching.insert(page.id)
            stateLock.unlock()

            var session: CdpSession?
            do {
                let s = try CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 4000)
                session = s
                let title = CdpHelper.shortTitle(page)
                let entry = AttachedEntry(session: s, title: title)

                s.onClose = {
                    stateLock.lock()
                    let removed = attached.removeValue(forKey: page.id)
                    stateLock.unlock()
                    if let removed = removed {
                        self.log("[-] 窗口已关闭: \(removed.title)")
                    }
                }

                _ = try s.send("Page.enable", params: nil, timeoutMs: 5000)
                let source = BindingSource(s)
                s.on("Runtime.bindingCalled") { params in
                    guard let name = params["name"]?.stringValue,
                          let payloadStr = params["payload"]?.stringValue else { return }
                    stateLock.lock()
                    let manifestSnap = manifest
                    stateLock.unlock()
                    guard name == manifestSnap.settingBinding else { return }
                    guard let kv = try? MiniJson.parseObject(payloadStr) else { return }
                    if kv["action"]?.stringValue == "fileLinkAction" || kv["key"]?.stringValue == "fileLinkContextMenu" {
                        guard let id = params["executionContextId"]?.intValue else { return }
                        DispatchQueue.global().async {
                            guard source.verify(id, page, s, fileAction: kv["action"]?.stringValue == "fileLinkAction") else { return }
                            if kv["action"]?.stringValue != "fileLinkAction" {
                                if let value = kv["value"] { _ = CdpHelper.updateConfigSetting(baseDir: self.baseDir, manifest: manifestSnap, key: "fileLinkContextMenu", value: value) }
                                return
                            }
                            let mode = kv["mode"]?.stringValue ?? ""
                            let enabled = CdpHelper.readConfig(baseDir: self.baseDir, manifest: manifestSnap)["fileLinkContextMenu"]?.boolValue != false
                            let ok = enabled && self.handleFileLinkAction(kv["uri"]?.stringValue ?? "", mode: mode)
                            let response: [String: JsonValue] = ["requestId": kv["requestId"] ?? .null, "ok": .bool(ok), "mode": .string(mode)]
                            let json = MiniJson.stringify(.object(response), pretty: false)
                            _ = try? s.send("Runtime.evaluate", params: ["contextId": .int(Int64(id)), "expression": .string("window.__agClaudeStudio?.onFileLinkActionResult?.(" + json + ")")])
                        }
                        return
                    }
                    if let key = kv["key"]?.stringValue, let value = kv["value"] {
                        if CdpHelper.updateConfigSetting(baseDir: self.baseDir, manifest: manifestSnap, key: key, value: value) {
                            self.log("[⚙] 设置已保存: \(key) = \(MiniJson.stringify(value, pretty: false))")
                        }
                    }
                }

                _ = try s.send("Runtime.enable", params: nil, timeoutMs: 5000)
                stateLock.lock()
                let bindingName = manifest.settingBinding
                let exprSnap = currentExpr
                let cfgExprSnap = currentConfigExpr
                stateLock.unlock()

                _ = try s.send("Runtime.addBinding", params: ["name": .string(bindingName)], timeoutMs: 5000)

                stateLock.lock()
                attached[page.id] = entry
                attaching.remove(page.id)
                stateLock.unlock()

                let evalVal = try applyToEntry(entry, exprSnap, cfgExprSnap, false)
                let status = evalVal.objectValue?["status"]?.stringValue ?? "ok"
                stateLock.lock()
                hadAttachedWindow = true
                stateLock.unlock()
                self.log("[✓] 已注入 agy-claude-studio: \(title) (\(status))")
            } catch {
                stateLock.lock()
                attaching.remove(page.id)
                let removed = attached.removeValue(forKey: page.id)
                stateLock.unlock()
                removed?.session.close()
                session?.close()
                self.log("[!] 注入失败，稍后重试: \(CdpHelper.shortTitle(page)) — \(error.localizedDescription)")
            }
        }

        let reloadQueue = DispatchQueue(label: "io.github.eosglyph.agy-claude-studio.reload")
        var pendingReloadWork: DispatchWorkItem?
        var pendingChangedHint: String?

        let performReload: (String?) -> Void = { hintName in
            pendingReloadWork?.cancel()
            pendingReloadWork = nil
            pendingChangedHint = nil

            let currentStamp = self.computeDirStamp()
            stateLock.lock()
            let detectedChange = self.firstChangedFile(oldStamp: lastDirStamp, newStamp: currentStamp)
            if detectedChange == nil {
                stateLock.unlock()
                return
            }
            lastDirStamp = currentStamp
            stateLock.unlock()

            let changedName = detectedChange ?? hintName ?? "config.json"
            do {
                let nextManifest = try PluginManifest.load(baseDir: self.baseDir)
                let nextCfg = CdpHelper.readConfig(baseDir: self.baseDir, manifest: nextManifest)
                let nextHashes = try CdpHelper.readBundleAndCssHashes(baseDir: self.baseDir, manifest: nextManifest)
                stateLock.lock()
                let refreshOnly = !currentCodeHash.isEmpty && nextHashes.codeHash == currentCodeHash && nextHashes.cssHash == currentCssHash
                stateLock.unlock()

                let nextExpr: String
                if refreshOnly {
                    stateLock.lock()
                    nextExpr = currentExpr
                    stateLock.unlock()
                } else {
                    nextExpr = try CdpHelper.buildInjectExpression(baseDir: self.baseDir, manifest: nextManifest)
                }
                let nextConfigExpr = CdpHelper.buildConfigScriptExpression(
                    baseDir: self.baseDir,
                    manifest: nextManifest,
                    expectedCodeHash: nextHashes.codeHash
                )

                stateLock.lock()
                manifest = nextManifest
                currentCodeHash = nextHashes.codeHash
                currentCssHash = nextHashes.cssHash
                currentExpr = nextExpr
                currentConfigExpr = nextConfigExpr
                cfgAutoRelaunch = nextCfg["autoRelaunchWithCdp"]?.boolValue ?? true
                cfgExitOnHostClose = nextCfg["exitOnHostClose"]?.boolValue ?? false

                let entries = Array(attached.values)
                stateLock.unlock()

                var n = 0
                for entry in entries {
                    if (try? applyToEntry(entry, nextExpr, nextConfigExpr, refreshOnly)) != nil {
                        n += 1
                    }
                }
                self.log("[↻] \(changedName) 已变更，已热更新 \(n) 个窗口\(refreshOnly ? "（轻量配置同步）" : "")")
            } catch {
                self.log("[!] 读取文件失败: \(error.localizedDescription)")
            }
        }

        let scheduleReload: (String?) -> Void = { hintName in
            reloadQueue.async {
                if let hint = hintName { pendingChangedHint = hint }
                pendingReloadWork?.cancel()
                let work = DispatchWorkItem {
                    let hint = pendingChangedHint
                    pendingChangedHint = nil
                    performReload(hint)
                }
                pendingReloadWork = work
                reloadQueue.asyncAfter(deadline: .now() + .milliseconds(180), execute: work)
            }
        }

        var dirSource: DispatchSourceFileSystemObject?
        let dirFd = open(baseDir, O_EVTONLY)
        if dirFd >= 0 {
            let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: dirFd, eventMask: [.write, .rename, .extend, .delete], queue: reloadQueue)
            src.setEventHandler {
                let currentStamp = self.computeDirStamp()
                stateLock.lock()
                let changed = self.firstChangedFile(oldStamp: lastDirStamp, newStamp: currentStamp)
                stateLock.unlock()
                if let changed = changed {
                    scheduleReload(changed)
                }
            }
            src.setCancelHandler {
                close(dirFd)
            }
            src.resume()
            dirSource = src
        }

        let envCdpOverride = !(ProcessInfo.processInfo.environment["AG_CDP_PORT"]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        let isExplicitPort = (overridePort != nil || envCdpOverride)
        let watchStart = Date()
        var lastPort: Int?
        var consecutivePortFailures = 0
        var noCdpRunningTicks = 0
        var warnedNoCdpSig = ""
        var relaunchedPidSig = ""
        var lastRelaunchAt = Date.distantPast
        var cdpFlagCheckedSig = ""
        var cdpFlagCheckedVal = false

        while !isExiting() {
            if let ppid = parentPid, !CdpHelper.isProcessAlive(ppid) {
                log("[*] 父进程 \(ppid) 已退出，守护进程自动停止")
                break
            }

            // Poll fallback for in-place edits that don't fire directory vnode write events
            let enabled = hostEnabled()
            reloadQueue.sync {
                if !enabled {
                    stateLock.lock()
                    let entries = Array(attached.values)
                    let removeExpr = manifest.removeExpression
                    attached.removeAll()
                    stateLock.unlock()
                    for entry in entries {
                        entry.session.onClose = nil
                        for id in [entry.configScriptId, entry.bootstrapScriptId].compactMap({ $0 }) {
                            _ = try? entry.session.send("Page.removeScriptToEvaluateOnNewDocument", params: ["identifier": .string(id)], timeoutMs: 5000)
                        }
                        _ = try? entry.session.evaluate(removeExpr, awaitPromise: false)
                        entry.session.close()
                    }
                }
                performReload(nil)
            }

            stateLock.lock()
            let monitorExit = exitOnHostCloseFlag || cfgExitOnHostClose
            stateLock.unlock()
            if !enabled && !monitorExit {
                _ = exitSem.wait(timeout: .now() + .milliseconds(pollMs))
                continue
            }

            var sleepMs = pollMs
            let port = CdpHelper.readPort(overridePort: overridePort)
            var pages: [CdpPageInfo]? = nil
            if let port = port {
                pages = try? CdpHelper.listPages(port: port)
            }

            if let port = port, let pages = pages {
                consecutivePortFailures = 0
                noCdpRunningTicks = 0
                warnedNoCdpSig = ""
                cdpFlagCheckedSig = ""
                cdpFlagCheckedVal = false

                if lastPort != port {
                    stateLock.lock()
                    let oldEntries = Array(attached.values)
                    attached.removeAll()
                    stateLock.unlock()
                    for oldEntry in oldEntries {
                        oldEntry.session.close()
                    }
                    log("[+] 连接到调试端口 \(port)")
                    lastPort = port
                }

                let group = DispatchGroup()
                for page in pages {
                    stateLock.lock()
                    let needsAttach = (attached[page.id] == nil && !attaching.contains(page.id))
                    stateLock.unlock()
                    if enabled && needsAttach {
                        group.enter()
                        DispatchQueue.global(qos: .utility).async {
                            attachPage(page)
                            group.leave()
                        }
                    }
                }
                group.wait() // Finish this attach batch before the next tick can retire entries.
            } else {
                consecutivePortFailures += 1
                if consecutivePortFailures >= 3 {
                    stateLock.lock()
                    let staleEntries = Array(attached.values)
                    attached.removeAll()
                    stateLock.unlock()
                    for oldEntry in staleEntries {
                        oldEntry.session.close()
                    }
                    lastPort = nil
                }

                stateLock.lock()
                let hadWin = hadAttachedWindow
                let attachedEmpty = attached.isEmpty
                let autoRelaunch = cfgAutoRelaunch
                let exitOnClose = exitOnHostCloseFlag || cfgExitOnHostClose
                stateLock.unlock()

                let runningPids = isExplicitPort ? [] : CdpHelper.detectAntigravityProcessPids()
                if exitOnClose && hadWin && attachedEmpty && consecutivePortFailures >= 3 && runningPids.isEmpty {
                    log("[*] Antigravity 宿主已关闭，守护进程自动退出")
                    break
                }
                if exitOnClose && startupGraceEnabled && !hadWin && attachedEmpty && consecutivePortFailures >= 2 && runningPids.isEmpty && Date().timeIntervalSince(watchStart) >= startupGraceSeconds {
                    let graceText = startupGraceSeconds.rounded() == startupGraceSeconds ? String(Int(startupGraceSeconds)) : String(startupGraceSeconds)
                    log("[*] 启动宽限期（\(graceText) 秒）已到且未检测到 Antigravity CDP 窗口，监听进程自动退出")
                    break
                }

                if enabled && !runningPids.isEmpty {
                    noCdpRunningTicks += 1
                    let pidSig = runningPids.map { String($0) }.joined(separator: ",")
                    if noCdpRunningTicks >= 3 {
                        if cdpFlagCheckedSig != pidSig {
                            cdpFlagCheckedSig = pidSig
                            cdpFlagCheckedVal = CdpHelper.hasAntigravityCdpFlag(pids: runningPids)
                        }
                        if cdpFlagCheckedVal {
                            if warnedNoCdpSig != "cdp:\(pidSig)" {
                                warnedNoCdpSig = "cdp:\(pidSig)"
                                log("[*] 检测到 Antigravity 已携带 --remote-debugging-port 参数，继续等待调试端口响应...")
                            }
                        } else {
                            if warnedNoCdpSig != pidSig {
                                warnedNoCdpSig = pidSig
                                log("[!] \(CdpHelper.cdpUnavailableMessage(running: true, port: port))")
                                if !autoRelaunch {
                                    log("[*] 提示：可在 config.json 中设置 \"autoRelaunchWithCdp\": true 以启用自动温和重启接管")
                                }
                            }
                            if enabled && autoRelaunch && hostEnabled() && relaunchedPidSig != pidSig && Date().timeIntervalSince(lastRelaunchAt) >= 60.0 {
                                relaunchedPidSig = pidSig
                                lastRelaunchAt = Date()
                                log("[↻] autoRelaunchWithCdp 已启用：正在温和重启 Antigravity 并附加 --remote-debugging-port=0 ...")
                                if CdpHelper.relaunchAntigravityWithCdp(port: 0) {
                                    log("[✓] 已以 CDP 模式重启 Antigravity，等待窗口就绪...")
                                    noCdpRunningTicks = 0
                                    cdpFlagCheckedSig = ""
                                    cdpFlagCheckedVal = false
                                } else {
                                    log("[!] 自动重启未完成，请手动完全退出 Antigravity 后以 --remote-debugging-port=0 启动")
                                }
                            }
                        }
                    }
                } else {
                    noCdpRunningTicks = 0
                    warnedNoCdpSig = ""
                    cdpFlagCheckedSig = ""
                    cdpFlagCheckedVal = false
                    if consecutivePortFailures >= 3 && !(startupGraceEnabled && !hadWin) {
                        sleepMs = max(pollMs, 5000)
                    }
                }
            }

            _ = exitSem.wait(timeout: .now() + DispatchTimeInterval.milliseconds(sleepMs))
        }

        dirSource?.cancel()
        termSource.cancel()
        intSource.cancel()

        stateLock.lock()
        let finalEntries = Array(attached.values)
        attached.removeAll()
        stateLock.unlock()
        for entry in finalEntries {
            entry.session.close()
        }

        releasePidFile(selfPid: selfPid)
        flock(lockFd, LOCK_UN)
        close(lockFd)
        return 0
    }

    func runLaunchAndWatch(
        overridePort: Int?,
        relaunchFlag: Bool,
        replaceExisting: Bool,
        parentPid: Int32?,
        startupGraceSeconds: Double,
        outFile: String?
    ) -> Int32 {
        if !hostEnabled() {
            return runWatch(overridePort: overridePort, exitOnHostCloseFlag: true, parentPid: parentPid, startupGraceEnabled: true, startupGraceSeconds: startupGraceSeconds, replaceExisting: replaceExisting, waitBrieflyForLock: true)
        }
        try? FileManager.default.createDirectory(atPath: baseDir, withIntermediateDirectories: true, attributes: nil)
        var cfgAutoRelaunch = true
        if let manifest = try? PluginManifest.load(baseDir: baseDir) {
            let initCfg = CdpHelper.readConfig(baseDir: baseDir, manifest: manifest)
            cfgAutoRelaunch = initCfg["autoRelaunchWithCdp"]?.boolValue ?? true
        }
        let allowRelaunch = relaunchFlag || cfgAutoRelaunch
        let res = CdpHelper.ensureAntigravityWithCdp(allowRelaunch: allowRelaunch, overridePort: overridePort)
        if !res.ok {
            log("[!] 启动 Antigravity (CDP) 失败 [\(res.action)]: \(res.message)")
            Self.writeResult(outFile: outFile, ok: false, message: res.message, pages: nil)
            if outFile == nil && ProcessInfo.processInfo.environment["AGY_CS_NO_UI"] != "1" {
                let alertProc = Process()
                alertProc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                alertProc.arguments = [
                    "-e",
                    "on run argv\ndisplay alert \"Claude Studio\" message (item 1 of argv) as warning\nend run",
                    "--",
                    res.message
                ]
                alertProc.standardInput = FileHandle.nullDevice
                alertProc.standardOutput = FileHandle.nullDevice
                alertProc.standardError = FileHandle.nullDevice
                do {
                    try alertProc.run()
                    alertProc.waitUntilExit()
                } catch {}
            }
            return 1
        }

        let launchMsg = "[*] 启动就绪 [\(res.action)]: \(res.message)"
        return runWatch(
            overridePort: overridePort,
            exitOnHostCloseFlag: true,
            parentPid: parentPid,
            startupGraceEnabled: true,
            startupGraceSeconds: startupGraceSeconds,
            replaceExisting: replaceExisting,
            waitBrieflyForLock: true,
            initialLog: launchMsg
        )
    }
}

func runWatcherMain() -> Int32 {
    var mode = "watch"
    var customDir: String?
    var overridePort: Int?
    var outFile: String?
    var relaunchFlag = false
    var replaceExisting = false
    var exitOnHostCloseFlag = false
    var parentPid: Int32?

    var startupGraceSeconds = CdpHelper.defaultStartupGraceSeconds
    if let envGrace = ProcessInfo.processInfo.environment["AG_STARTUP_GRACE_SEC"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       let g = Double(envGrace), g.isFinite, g > 0 {
        startupGraceSeconds = g
    }

    var pollMs = 2000
    if let envPoll = ProcessInfo.processInfo.environment["AG_WATCH_POLL_MS"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       let p = Int(envPoll) {
        pollMs = max(100, min(10000, p))
    }

    if let envPpid = ProcessInfo.processInfo.environment["AG_PARENT_PID"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       let p = Int32(envPpid), p > 0 {
        parentPid = p
    }

    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        let a = args[i]
        if a == "--watch" { mode = "watch" }
        else if a == "--once" { mode = "once" }
        else if a == "--remove" { mode = "remove" }
        else if a == "--launch" { mode = "launch" }
        else if a == "--relaunch" { relaunchFlag = true }
        else if a == "--replace" { replaceExisting = true }
        else if a == "--exit-on-host-close" { exitOnHostCloseFlag = true }
        else if a == "--parent-pid" && i + 1 < args.count {
            i += 1
            if let p = Int32(args[i]), p > 0 { parentPid = p }
        }
        else if a == "--dir" && i + 1 < args.count { i += 1; customDir = args[i] }
        else if a == "--cdp-port" && i + 1 < args.count {
            i += 1
            if let p = Int(args[i]), p > 0 { overridePort = p }
        }
        else if a == "--out" && i + 1 < args.count { i += 1; outFile = args[i] }
        else if a == "--startup-grace" && i + 1 < args.count {
            i += 1
            if let g = Double(args[i]), g.isFinite, g > 0 { startupGraceSeconds = g }
        }
        else if a.hasPrefix("--startup-grace=") {
            let raw = String(a.dropFirst("--startup-grace=".count))
            if let g = Double(raw), g.isFinite, g > 0 { startupGraceSeconds = g }
        }
        i += 1
    }

    let rawBase = (customDir?.isEmpty == false)
        ? customDir!
        : ((args[0] as NSString).deletingLastPathComponent)
    let baseDir = URL(fileURLWithPath: rawBase.isEmpty ? "." : rawBase).standardizedFileURL.path
    let app = WatcherApp(baseDir: baseDir, isWatch: (mode == "watch" || mode == "launch"), pollMs: pollMs)

    if mode == "once" {
        return app.runOnce(overridePort: overridePort, outFile: outFile)
    }
    if mode == "remove" {
        return app.runRemove(overridePort: overridePort, outFile: outFile)
    }
    if mode == "launch" {
        return app.runLaunchAndWatch(
            overridePort: overridePort,
            relaunchFlag: relaunchFlag,
            replaceExisting: replaceExisting,
            parentPid: parentPid,
            startupGraceSeconds: startupGraceSeconds,
            outFile: outFile
        )
    }
    return app.runWatch(
        overridePort: overridePort,
        exitOnHostCloseFlag: exitOnHostCloseFlag,
        parentPid: parentPid,
        startupGraceEnabled: exitOnHostCloseFlag,
        startupGraceSeconds: startupGraceSeconds,
        replaceExisting: replaceExisting,
        waitBrieflyForLock: false
    )
}

exit(runWatcherMain())
