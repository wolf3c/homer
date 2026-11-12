import Foundation
import IOKit.pwr_mgt

final class IOKitWakeStore: WakeStore {
    private let copyEvents: () -> CFArray?
    init(copyEvents: @escaping () -> CFArray? = { IOPMCopyScheduledPowerEvents()?.takeRetainedValue() }) { self.copyEvents = copyEvents }
    func ownedEvents() throws -> [(WakeOwner, WakeEvent)] {
        guard let events = copyEvents() else { return [] }
        guard let values = events as? [[String: Any]] else { throw PowerError("macos_power_query_failed") }
        return Self.decodeOwnedEvents(values)
    }
    static func decodeOwnedEvents(_ values: [[String: Any]]) -> [(WakeOwner, WakeEvent)] {
        return values.compactMap { item in
            guard item[kIOPMPowerEventTypeKey] as? String == kIOPMAutoWake,
                  let name = item[kIOPMPowerEventAppNameKey] as? String,
                  let identity = WakeOwner.parseEventName(name), let date = item[kIOPMPowerEventTimeKey] as? Date else { return nil }
            let milliseconds = date.timeIntervalSince1970 * 1000
            guard milliseconds.isFinite, milliseconds > 0, milliseconds <= 9_007_199_254_740_991 else { return nil }
            let event = WakeEvent(id: identity.id, at: Int64(milliseconds.rounded()))
            return event.valid ? (identity.owner, event) : nil
        }
    }
    func list(_ owner: WakeOwner) throws -> [WakeEvent] { try ownedEvents().filter { $0.0 == owner }.map { $0.1 } }
    func schedule(_ owner: WakeOwner, _ event: WakeEvent) throws {
        let result = IOPMSchedulePowerEvent(Date(timeIntervalSince1970: Double(event.at) / 1000) as CFDate, owner.eventName(event.id) as CFString, kIOPMAutoWake as CFString)
        guard result == kIOReturnSuccess else { throw PowerError("macos_power_schedule_failed:\(result)") }
    }
    func cancel(_ owner: WakeOwner, _ event: WakeEvent) throws {
        let result = IOPMCancelScheduledPowerEvent(Date(timeIntervalSince1970: Double(event.at) / 1000) as CFDate, owner.eventName(event.id) as CFString, kIOPMAutoWake as CFString)
        guard result == kIOReturnSuccess else { throw PowerError("macos_power_cancel_failed:\(result)") }
    }
}
