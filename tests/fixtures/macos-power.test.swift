import Foundation

private final class MemoryStore: WakeStore {
    var saved: [WakeOwner: [WakeEvent]] = [:]
    var failCancel = false
    var nativeQuery = false
    func list(_ owner: WakeOwner) throws -> [WakeEvent] {
        if !nativeQuery { return saved[owner] ?? [] }
        return try IOKitWakeStore(copyEvents: {
            let entries: [[String: Any]] = self.saved.flatMap { owner, events in events.map { event in
                ["eventtype": "wake", "scheduledby": owner.eventName(event.id), "time": Date(timeIntervalSince1970: Double(event.at) / 1000)]
            } }
            return entries.isEmpty ? nil : entries as CFArray
        }).list(owner)
    }
    func schedule(_ owner: WakeOwner, _ event: WakeEvent) throws { saved[owner, default: []].append(event) }
    func cancel(_ owner: WakeOwner, _ event: WakeEvent) throws {
        if failCancel { throw PowerError("macos_power_cancel_failed:5") }
        saved[owner]?.removeAll { $0 == event }
    }
}

@main private struct PowerTests {
    static func rejects(_ code: String, _ body: () throws -> Void) {
        do { try body(); fatalError("expected \(code)") }
        catch { precondition((error as? PowerError)?.code == code, "unexpected error") }
    }
    static func main() throws {
        let owner = WakeOwner(uid: 501, instance: String(repeating: "a", count: 64))
        let another = WakeOwner(uid: 502, instance: owner.instance)
        let profile = WakeOwner(uid: 501, instance: String(repeating: "d", count: 64))
        let first = WakeEvent(id: String(repeating: "b", count: 32), at: 2_000_000_001_000)
        let second = WakeEvent(id: String(repeating: "c", count: 32), at: 2_000_000_002_000)
        let third = WakeEvent(id: String(repeating: "e", count: 32), at: 2_000_000_003_000)
        let emptyStore = MemoryStore(), emptyLease = UUID()
        emptyStore.nativeQuery = true
        let emptyRegistry = WakeRegistry(store: emptyStore)
        emptyRegistry.open(owner, lease: emptyLease)
        let initialEvents = try emptyRegistry.list(owner, lease: emptyLease)
        precondition(initialEvents.isEmpty, "nil native queue is empty")
        try emptyRegistry.schedule(owner, lease: emptyLease, event: first, now: 2_000_000_000_000)
        try emptyRegistry.cancel(owner, lease: emptyLease, event: first)
        let finalEvents = try emptyRegistry.list(owner, lease: emptyLease)
        precondition(finalEvents.isEmpty, "deleting the last native event confirms an empty queue")
        try emptyRegistry.release(owner, lease: emptyLease)
        rejects("macos_power_query_failed") { _ = try IOKitWakeStore(copyEvents: { ["invalid"] as CFArray }).ownedEvents() }
        let store = MemoryStore(), registry = WakeRegistry(store: store), old = UUID(), current = UUID()
        registry.open(owner, lease: old)
        try registry.schedule(owner, lease: old, event: first, now: 2_000_000_000_000)
        try registry.schedule(owner, lease: old, event: first, now: 2_000_000_000_000)
        let one = try registry.list(owner, lease: old)
        precondition(one == [first], "idempotent receipt-loss retry")
        try registry.schedule(owner, lease: old, event: second, now: 2_000_000_000_000)
        rejects("macos_power_event_conflict") { try registry.schedule(owner, lease: old, event: WakeEvent(id: first.id, at: third.at), now: 2_000_000_000_000) }
        rejects("macos_power_event_limit") { try registry.schedule(owner, lease: old, event: third, now: 2_000_000_000_000) }
        let replacement = try registry.list(owner, lease: old)
        precondition(replacement == [first, second], "replacement must preserve old event")
        rejects("macos_power_event_mismatch") { try registry.cancel(owner, lease: old, event: WakeEvent(id: first.id, at: third.at)) }
        let afterMismatch = try registry.list(owner, lease: old)
        precondition(afterMismatch == [first, second], "time must match exactly")
        registry.open(another, lease: UUID()); registry.open(profile, lease: UUID())
        store.saved[another] = [first]; store.saved[profile] = [second]
        registry.open(owner, lease: current)
        try registry.release(owner, lease: old)
        precondition(store.saved[owner] == [first, second], "stale disconnect cannot clear new owner")
        rejects("macos_power_stale_owner") { _ = try registry.list(owner, lease: old) }
        try registry.cancel(owner, lease: current, event: first)
        precondition(store.saved[owner] == [second])
        precondition(store.saved[another] == [first] && store.saved[profile] == [second], "uid and profile isolation")
        store.failCancel = true
        rejects("macos_power_cancel_failed:5") { try registry.release(owner, lease: current) }
        precondition(store.saved[owner] == [second], "cleanup failure must remain visible")
        store.failCancel = false
        registry.open(owner, lease: current)
        try registry.release(owner, lease: current)
        precondition(store.saved[owner] == [], "owner crash cleanup")
        rejects("macos_power_event_invalid") { try registry.schedule(owner, lease: current, event: first, now: first.at) }
        for source in [
            #"{"op":"schedule","id":"../../foreign","at":2000000001000}"#,
            #"{"op":"schedule","id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","at":2000000001000,"command":"anything"}"#,
            #"{"op":"schedule","id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","at":true}"#,
            #"{"op":"schedule","id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","at":2000000001001}"#,
            #"{"op":"cancelall"}"#,
            #"{"op":"open","instance":"../outside"}"#
        ] { rejects("macos_power_request_invalid") { _ = try PowerCommand(Data(source.utf8)) } }
        let parsed = try PowerCommand(Data(#"{"op":"schedule","id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","at":2000000001000}"#.utf8))
        precondition(parsed.event == first)
        let name = owner.eventName(first.id)
        precondition(WakeOwner.parseEventName(name)?.owner == owner)
        precondition(WakeOwner.parseEventName(name)?.id == first.id)
        precondition(WakeOwner.parseEventName("com.apple.alarm.501." + owner.instance + "." + first.id) == nil)
        let entries: [[String: Any]] = [
            ["eventtype": "wake", "scheduledby": name, "time": Date(timeIntervalSince1970: 2_000_000_001)],
            ["eventtype": "shutdown", "scheduledby": name, "time": Date(timeIntervalSince1970: 2_000_000_001)],
            ["eventtype": "wake", "scheduledby": "com.apple.alarm", "time": Date(timeIntervalSince1970: 2_000_000_001)],
            ["eventtype": "wake", "scheduledby": name, "time": Date(timeIntervalSince1970: 2_000_000_001.5)],
            ["eventtype": "wake", "scheduledby": name, "time": "invalid"]
        ]
        let decoded = IOKitWakeStore.decodeOwnedEvents(entries)
        precondition(decoded.count == 1 && decoded[0].0 == owner && decoded[0].1 == first, "system parsing excludes foreign/non-wake/invalid events")
        print("macos_power_native_contract_passed")
    }
}
