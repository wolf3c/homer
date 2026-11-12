import Foundation

private final class PowerSession: NSObject, PowerServiceProtocol {
    let uid: uid_t
    let lease = UUID()
    let server: PowerServer
    var owner: WakeOwner?
    init(uid: uid_t, server: PowerServer) { self.uid = uid; self.server = server }
    func perform(_ request: Data, reply: @escaping (Data) -> Void) {
        server.queue.async {
            do {
                let command = try PowerCommand(request)
                if command.op == "open" {
                    guard self.owner == nil, !self.server.draining else { throw PowerError("macos_power_owner_unavailable") }
                    let owner = WakeOwner(uid: self.uid, instance: command.instance!)
                    self.server.registry.open(owner, lease: self.lease); self.owner = owner
                    reply(json(["ok": true, "result": NSNull()])); return
                }
                if command.op == "abort-uninstall" {
                    if self.server.uninstallLease == self.lease { self.server.uninstallUntil = .distantPast }
                    reply(json(["ok": true, "result": NSNull()])); return
                }
                guard let owner = self.owner else { throw PowerError("macos_power_owner_required") }
                var result: Any = NSNull()
                switch command.op {
                case "list": result = try self.server.registry.list(owner, lease: self.lease).map(\.value)
                case "schedule":
                    guard !self.server.draining else { throw PowerError("macos_power_uninstall_in_progress") }
                    try self.server.registry.schedule(owner, lease: self.lease, event: command.event!, now: Int64(Date().timeIntervalSince1970 * 1000))
                    result = command.event!.value
                case "cancel": try self.server.registry.cancel(owner, lease: self.lease, event: command.event!)
                case "close":
                    _ = try self.server.registry.list(owner, lease: self.lease)
                    try self.server.registry.release(owner, lease: self.lease); self.owner = nil
                case "prepare-uninstall":
                    guard try !self.server.registry.hasOtherOwner(owner, lease: self.lease), try !self.server.store.ownedEvents().contains(where: { $0.0 != owner }) else { throw PowerError("macos_power_other_instances_active") }
                    try self.server.registry.release(owner, lease: self.lease); self.owner = nil
                    self.server.uninstallLease = self.lease; self.server.uninstallUntil = Date().addingTimeInterval(30)
                default: throw PowerError("macos_power_request_invalid")
                }
                reply(json(["ok": true, "result": result]))
            } catch { reply(json(["ok": false, "error": powerError(error)])) }
        }
    }
}

private final class PowerServer: NSObject, NSXPCListenerDelegate {
    let queue = DispatchQueue(label: powerServiceName)
    let store = IOKitWakeStore()
    lazy var registry = WakeRegistry(store: store)
    var connections: [UUID: NSXPCConnection] = [:]
    var uninstallUntil = Date.distantPast
    var uninstallLease: UUID?
    var draining: Bool { uninstallUntil > Date() }
    let requirement: String
    init(team: String) { requirement = peerRequirement(identifier: powerClientIdentifier, team: team) }
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard connection.effectiveUserIdentifier != 0 else { return false }
        let session = PowerSession(uid: connection.effectiveUserIdentifier, server: self)
        connection.setCodeSigningRequirement(requirement)
        connection.exportedInterface = NSXPCInterface(with: PowerServiceProtocol.self)
        connection.exportedObject = session
        connection.invalidationHandler = {
            self.queue.async {
                if let owner = session.owner {
                    do { try self.registry.release(owner, lease: session.lease) }
                    catch { NSLog("macos_power_disconnect_cleanup_failed %@", powerError(error)) }
                }
                self.connections.removeValue(forKey: session.lease)
            }
        }
        connection.interruptionHandler = { [weak connection] in connection?.invalidate() }
        queue.sync { connections[session.lease] = connection }
        connection.resume(); return true
    }
}

@main private struct PowerHelper {
    static func main() {
        do {
            guard geteuid() == 0 else { throw PowerError("macos_power_root_required") }
            let server = PowerServer(team: try ownSigningTeam()), listener = NSXPCListener(machServiceName: powerServiceName)
            listener.setConnectionCodeSigningRequirement(server.requirement)
            listener.delegate = server; listener.resume()
            withExtendedLifetime((server, listener)) { dispatchMain() }
        } catch { NSLog("macos_power_helper_start_failed %@", powerError(error)); exit(1) }
    }
}
