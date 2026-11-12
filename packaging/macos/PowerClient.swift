import AppKit
import Foundation
import Security
import ServiceManagement

private final class PowerClient {
    private let instance: String
    private let team: String
    private let service: SMAppService
    private var connection: NSXPCConnection?
    init(instance: String) throws {
        self.instance = instance; team = try ownSigningTeam()
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard executable.path == bundle.appendingPathComponent("Contents/MacOS/homer-power-client").path,
              Bundle.main.bundleURL.standardizedFileURL == bundle,
              Bundle.main.bundleIdentifier == "app.homer.desktop" else { throw PowerError("macos_power_bundle_required") }
        var code: SecStaticCode?, requirement: SecRequirement?
        guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(peerRequirement(identifier: "app.homer.desktop", team: team) as CFString, [], &requirement) == errSecSuccess,
              SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw PowerError("macos_power_bundle_signature_invalid") }
        service = SMAppService.daemon(plistName: powerPlistName)
    }
    private func call(_ command: [String: Any], on connection: NSXPCConnection) throws -> Any {
        let semaphore = DispatchSemaphore(value: 0), lock = NSLock()
        var response: Result<Any, Error>?
        func finish(_ value: Result<Any, Error>) { lock.lock(); if response == nil { response = value; semaphore.signal() }; lock.unlock() }
        let proxy = connection.remoteObjectProxyWithErrorHandler { _ in finish(.failure(PowerError("macos_power_connection_failed"))) } as? PowerServiceProtocol
        guard let proxy else { throw PowerError("macos_power_connection_failed") }
        proxy.perform(json(command)) { data in
            guard data.count <= 65536, let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let ok = value["ok"] as? Bool else { finish(.failure(PowerError("macos_power_response_invalid"))); return }
            if ok { finish(.success(value["result"] ?? NSNull())) }
            else { finish(.failure(PowerError(value["error"] as? String ?? "macos_power_native_failed"))) }
        }
        guard semaphore.wait(timeout: .now() + 8) == .success else { throw PowerError("macos_power_request_timeout") }
        lock.lock(); let result = response!; lock.unlock()
        return try result.get()
    }
    private func connect() throws -> NSXPCConnection {
        guard service.status == .enabled else { throw PowerError("macos_power_not_authorized") }
        if let connection { return connection }
        let candidate = NSXPCConnection(machServiceName: powerServiceName, options: .privileged)
        candidate.setCodeSigningRequirement(peerRequirement(identifier: powerHelperIdentifier, team: team))
        candidate.remoteObjectInterface = NSXPCInterface(with: PowerServiceProtocol.self)
        candidate.resume()
        do { _ = try call(["op": "open", "instance": instance], on: candidate) }
        catch { candidate.invalidate(); throw error }
        connection = candidate; return candidate
    }
    private func request(_ command: [String: Any]) throws -> Any {
        let current = try connect()
        do { return try call(command, on: current) }
        catch {
            if powerError(error) != "macos_power_request_timeout" { connection = nil; current.invalidate() }
            throw error
        }
    }
    func status() -> [String: Any] {
        switch service.status {
        case .notRegistered: return ["supported": true, "authorization": "required", "reason": "macos_power_registration_required"]
        case .requiresApproval: return ["supported": true, "authorization": "required", "reason": "macos_power_approval_required"]
        case .notFound: return ["supported": false, "authorization": "unavailable", "reason": "macos_power_helper_missing"]
        case .enabled:
            do { _ = try request(["op": "list"]); return ["supported": true, "authorization": "authorized"] }
            catch { return ["supported": false, "authorization": "unavailable", "reason": powerError(error)] }
        @unknown default: return ["supported": false, "authorization": "unavailable", "reason": "macos_power_status_unknown"]
        }
    }
    func authorize() -> [String: Any] {
        do {
            if service.status != .enabled { try service.register() }
            if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            return status()
        } catch {
            if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            let denied = (error as NSError).domain == "SMAppServiceErrorDomain" && (error as NSError).code == 1
            return ["supported": true, "authorization": denied ? "denied" : "unavailable", "reason": denied ? "macos_power_authorization_denied" : "macos_power_registration_failed"]
        }
    }
    func handle(_ command: PowerCommand) throws -> Any {
        switch command.op {
        case "status": return status()
        case "authorize": return authorize()
        case "list": return try request(["op": "list"])
        case "schedule", "cancel": return try request(command.event!.value.merging(["op": command.op]) { _, new in new })
        case "close":
            // Reconnect to reconcile after a lost connection; never unregister a shared helper here.
            if service.status == .enabled { _ = try request(["op": "close"]) }
            else if try !IOKitWakeStore().list(WakeOwner(uid: geteuid(), instance: instance)).isEmpty { throw PowerError("macos_power_cleanup_not_authorized") }
            connection?.invalidate(); connection = nil; return NSNull()
        default: throw PowerError("macos_power_request_invalid")
        }
    }
    func uninstall() throws {
        // An update/uninstaller must finish this before replacing or removing the signed app bundle.
        if service.status == .enabled { _ = try request(["op": "prepare-uninstall"]) }
        else if try !IOKitWakeStore().ownedEvents().isEmpty { throw PowerError("macos_power_cleanup_not_authorized") }
        if service.status == .notRegistered || service.status == .notFound { return }
        do { try service.unregister() }
        catch { if let connection { _ = try? call(["op": "abort-uninstall"], on: connection) }; throw PowerError("macos_power_unregister_failed") }
        connection?.invalidate(); connection = nil
        guard service.status == .notRegistered || service.status == .notFound else { throw PowerError("macos_power_unregister_unconfirmed") }
    }
}

@main private struct PowerClientMain {
    static let outputLock = NSLock()
    static func emit(_ value: [String: Any]) {
        outputLock.lock(); defer { outputLock.unlock() }
        FileHandle.standardOutput.write(json(value) + Data([10]))
    }
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst()), uninstall = args.first == "--uninstall"
        let expected = uninstall ? Array(args.dropFirst()) : args
        guard expected.count == 2, expected[0] == "--instance", hex(expected[1], count: 64) else { exit(2) }
        let client: Result<PowerClient, Error> = Result { try PowerClient(instance: expected[1]) }
        if uninstall {
            do { try client.get().uninstall(); emit(["ok": true]) }
            catch { emit(["ok": false, "error": powerError(error)]); exit(1) }
            return
        }
        let wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in emit(["kind": "wake"]) }
        DispatchQueue.global(qos: .utility).async {
            var buffer = Data()
            while true {
                let chunk = FileHandle.standardInput.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)
                if buffer.count > 65536 { exit(2) }
                while let newline = buffer.firstIndex(of: 10) {
                    let line = buffer.prefix(upTo: newline); buffer.removeSubrange(...newline)
                    var requestId: Int64 = 0
                    do {
                        guard line.count <= 4096, var fields = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                              let number = fields.removeValue(forKey: "requestId") as? NSNumber,
                              CFGetTypeID(number) != CFBooleanGetTypeID(), number.int64Value > 0,
                              number.doubleValue == Double(number.int64Value), number.int64Value <= 9_007_199_254_740_991 else { throw PowerError("macos_power_request_invalid") }
                        requestId = number.int64Value
                        let command = try PowerCommand(json(fields))
                        let result: Any
                        switch client {
                        case .success(let active): result = try active.handle(command)
                        case .failure(let error):
                            if command.op == "status" { result = ["supported": false, "authorization": "unavailable", "reason": powerError(error)] }
                            else if command.op == "close" { result = NSNull() }
                            else { throw error }
                        }
                        emit(["requestId": requestId, "ok": true, "result": result])
                        if command.op == "close" { exit(0) }
                    } catch { emit(["requestId": requestId, "ok": false, "error": powerError(error)]) }
                }
            }
            if case .success(let active) = client {
                do { _ = try active.handle(PowerCommand(Data(#"{"op":"close"}"#.utf8))) }
                catch { exit(1) }
            }
            exit(0)
        }
        withExtendedLifetime(wakeObserver) { dispatchMain() }
    }
}
