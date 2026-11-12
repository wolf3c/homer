import Foundation
import Security

let powerServiceName = "app.homer.desktop.power"
let powerPlistName = powerServiceName + ".plist"
let powerClientIdentifier = powerServiceName + ".client"
let powerHelperIdentifier = powerServiceName + ".helper"

struct PowerError: Error { let code: String; init(_ code: String) { self.code = code } }
func powerError(_ error: Error) -> String { (error as? PowerError)?.code ?? "macos_power_native_failed" }
func hex(_ value: String, count: Int) -> Bool { value.utf8.count == count && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
func json(_ value: Any) -> Data { (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data(#"{"ok":false,"error":"macos_power_native_failed"}"#.utf8) }

struct WakeEvent: Equatable {
    let id: String
    let at: Int64
    var value: [String: Any] { ["id": id, "at": at] }
    var valid: Bool { hex(id, count: 32) && at > 0 && at <= 9_007_199_254_740_991 && at % 1000 == 0 }
}
struct WakeOwner: Hashable {
    let uid: uid_t
    let instance: String
    func eventName(_ id: String) -> String { "\(powerServiceName).v1.\(uid).\(instance).\(id)" }
    static func parseEventName(_ name: String) -> (owner: WakeOwner, id: String)? {
        let prefix = powerServiceName + ".v1."
        guard name.hasPrefix(prefix) else { return nil }
        let parts = name.dropFirst(prefix.count).split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, let uid = uid_t(parts[0]), String(uid) == parts[0], hex(parts[1], count: 64), hex(parts[2], count: 32) else { return nil }
        return (WakeOwner(uid: uid, instance: parts[1]), parts[2])
    }
}

// Commands contain only identity and absolute UTC time, never business or shell payloads.
struct PowerCommand {
    let op: String
    let instance: String?
    let event: WakeEvent?
    init(_ data: Data) throws {
        guard data.count <= 4096, let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let op = fields["op"] as? String else { throw PowerError("macos_power_request_invalid") }
        self.op = op
        var keys: Set<String> = ["op"]
        if op == "open" {
            guard let instance = fields["instance"] as? String, hex(instance, count: 64) else { throw PowerError("macos_power_request_invalid") }
            self.instance = instance; event = nil; keys.insert("instance")
        } else if op == "schedule" || op == "cancel" {
            guard let id = fields["id"] as? String, let number = fields["at"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == Double(number.int64Value) else { throw PowerError("macos_power_request_invalid") }
            let event = WakeEvent(id: id, at: number.int64Value)
            guard event.valid else { throw PowerError("macos_power_request_invalid") }
            self.event = event; instance = nil; keys.formUnion(["id", "at"])
        } else {
            guard ["status", "authorize", "list", "close", "prepare-uninstall", "abort-uninstall"].contains(op) else { throw PowerError("macos_power_request_invalid") }
            instance = nil; event = nil
        }
        guard Set(fields.keys) == keys else { throw PowerError("macos_power_request_invalid") }
    }
}

protocol WakeStore {
    func list(_ owner: WakeOwner) throws -> [WakeEvent]
    func schedule(_ owner: WakeOwner, _ event: WakeEvent) throws
    func cancel(_ owner: WakeOwner, _ event: WakeEvent) throws
}

// Only the helper's serial queue owns this registry. Connection generations fence late callbacks.
final class WakeRegistry {
    private let store: WakeStore
    private var owners: [WakeOwner: UUID] = [:]
    init(store: WakeStore) { self.store = store }
    func open(_ owner: WakeOwner, lease: UUID) { owners[owner] = lease }
    private func requireOwner(_ owner: WakeOwner, _ lease: UUID) throws {
        guard owners[owner] == lease else { throw PowerError("macos_power_stale_owner") }
    }
    func list(_ owner: WakeOwner, lease: UUID) throws -> [WakeEvent] {
        try requireOwner(owner, lease)
        return try store.list(owner).sorted { $0.at == $1.at ? $0.id < $1.id : $0.at < $1.at }
    }
    func schedule(_ owner: WakeOwner, lease: UUID, event: WakeEvent, now: Int64) throws {
        guard event.valid, event.at > now else { throw PowerError("macos_power_event_invalid") }
        let events = try list(owner, lease: lease)
        if let existing = events.first(where: { $0.id == event.id }) {
            guard existing == event else { throw PowerError("macos_power_event_conflict") }
            return
        }
        guard events.count < 2 else { throw PowerError("macos_power_event_limit") }
        try store.schedule(owner, event)
        guard try store.list(owner).contains(event) else { throw PowerError("macos_power_schedule_unconfirmed") }
    }
    func cancel(_ owner: WakeOwner, lease: UUID, event: WakeEvent) throws {
        guard event.valid else { throw PowerError("macos_power_event_invalid") }
        let events = try list(owner, lease: lease)
        if let existing = events.first(where: { $0.id == event.id }) {
            guard existing == event else { throw PowerError("macos_power_event_mismatch") }
            try store.cancel(owner, event)
            guard try !store.list(owner).contains(event) else { throw PowerError("macos_power_cancel_unconfirmed") }
        }
    }
    func release(_ owner: WakeOwner, lease: UUID) throws {
        guard owners[owner] == lease else { return }
        var failure: Error?
        for event in try list(owner, lease: lease) {
            do { try cancel(owner, lease: lease, event: event) } catch { failure = error }
        }
        if let failure { throw failure }
        owners.removeValue(forKey: owner)
    }
    func hasOtherOwner(_ owner: WakeOwner, lease: UUID) throws -> Bool {
        try requireOwner(owner, lease)
        return owners.keys.contains { $0 != owner }
    }
}

@objc protocol PowerServiceProtocol {
    func perform(_ request: Data, reply: @escaping (Data) -> Void)
}

func ownSigningTeam() throws -> String {
    var dynamic: SecCode?, code: SecStaticCode?, information: CFDictionary?
    guard SecCodeCopySelf([], &dynamic) == errSecSuccess, let dynamic,
          SecCodeCopyStaticCode(dynamic, [], &code) == errSecSuccess, let code,
          SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
          let fields = information as? [String: Any], let team = fields[kSecCodeInfoTeamIdentifier as String] as? String,
          team.range(of: #"^[A-Z0-9]{10}$"#, options: .regularExpression) != nil else { throw PowerError("macos_power_developer_signature_required") }
    return team
}
func peerRequirement(identifier: String, team: String) -> String {
    // XPC applies this to each peer message using kernel identity, with no PID-reuse check.
    "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"\(team)\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
}
