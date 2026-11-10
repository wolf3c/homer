import AppKit
import ApplicationServices
import CoreImage
import CoreMedia
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

private struct Result: Encodable, Sendable {
    let kind: String
    var png: Data? = nil
    var width: Int? = nil
    var height: Int? = nil
    var ax: [WindowAXNode]? = nil
    var bounds: [Int]? = nil

    func send() -> Never {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        if let data = try? encoder.encode(self) {
            FileHandle.standardOutput.write(data)
        }
        exit(0)
    }
}

private struct WindowAXNode: Encodable, Sendable {
    let role: String
    let name: String?
    let value: String?
}

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

private func owner(_ element: AXUIElement) -> pid_t? {
    var value: pid_t = 0
    return AXUIElementGetPid(element, &value) == .success ? value : nil
}

private func bounds(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = attribute(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var origin = CGPoint.zero, dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &origin), AXValueGetValue(size as! AXValue, .cgSize, &dimensions),
          origin.x.isFinite, origin.y.isFinite, dimensions.width.isFinite, dimensions.height.isFinite,
          dimensions.width >= 0, dimensions.height >= 0 else { return nil }
    return CGRect(origin: origin, size: dimensions)
}

private struct SelectedWindowAX: Sendable {
    let id: CGWindowID
    let pid: pid_t
    let frame: CGRect
    let title: String

    func read(before deadline: DispatchTime) -> [WindowAXNode]? {
        guard DispatchTime.now() < deadline, AXIsProcessTrusted(), matchesWindowServer() else { return nil }
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.075)
        let app = AXUIElementCreateApplication(pid)
        // Chrome can defer its web AX tree until the application role is read.
        _ = attribute(app, kAXRoleAttribute)
        guard let windows = elements(app, kAXWindowsAttribute, limit: 16, requireAll: true) else { return nil }
        var match: AXUIElement?
        for window in windows {
            guard DispatchTime.now() < deadline, let rect = bounds(window) else { return nil }
            if rect == frame {
                guard match == nil else { return nil }
                match = window
            }
        }
        let appName = NSRunningApplication(processIdentifier: pid)?.localizedName
        let displayTitle = appName.map { title + " - " + $0 }
        guard let window = match, owner(window) == pid,
              attribute(window, kAXRoleAttribute) as? String == kAXWindowRole,
              let axTitle = attribute(window, kAXTitleAttribute) as? String,
              axTitle == title || axTitle == displayTitle,
              matchesWindowServer() else { return nil }

        var pending = [(window, frame)], seen = Set<AXUIElement>(), result: [WindowAXNode] = []
        var remaining = 4096
        while DispatchTime.now() < deadline, seen.count < 64, result.count < 24, let (node, clip) = pending.popLast() {
            guard seen.insert(node).inserted else { continue }
            var visible = clip
            if !CFEqual(node, window) {
                guard owner(node) == pid, let root = attribute(node, kAXWindowAttribute), CFEqual(root, window),
                      let rect = bounds(node), let role = attribute(node, kAXRoleAttribute) as? String,
                      attribute(node, kAXSubroleAttribute) as? String != kAXSecureTextFieldSubrole else { continue }
                visible = clip.intersection(rect)
                guard !visible.isEmpty else { continue }
                if clip.contains(rect), let item = excerpt(node, role: role) {
                    let size = item.role.utf16.count + (item.name?.utf16.count ?? 0) + (item.value?.utf16.count ?? 0)
                    if size <= remaining { result.append(item); remaining -= size }
                }
            }
            let children = elements(node, kAXVisibleChildrenAttribute, limit: 48) ?? elements(node, kAXChildrenAttribute, limit: 48) ?? []
            pending.append(contentsOf: children.reversed().map { ($0, visible) })
        }
        guard !result.isEmpty, DispatchTime.now() < deadline, AXIsProcessTrusted(),
              matchesWindowServer(), bounds(window) == frame, attribute(window, kAXTitleAttribute) as? String == axTitle else { return nil }
        return result
    }

    private func matchesWindowServer() -> Bool {
        guard let rows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else { return false }
        var found = false
        for row in rows where (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid {
            guard let data = row[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: data as CFDictionary) else { return false }
            if rect == frame {
                guard !found, (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value == id else { return false }
                found = true
            }
        }
        return found
    }

    private func excerpt(_ node: AXUIElement, role: String) -> WindowAXNode? {
        let value: String?
        switch role {
        case kAXStaticTextRole, kAXHeadingRole, kAXPopUpButtonRole:
            value = shortText(attribute(node, kAXValueAttribute))
        case kAXTextAreaRole, kAXTextFieldRole, kAXComboBoxRole:
            // AXValue on an editor can include text outside the captured view.
            value = visibleText(node)
        case kAXCheckBoxRole, kAXRadioButtonRole:
            value = (attribute(node, kAXValueAttribute) as? NSNumber)?.stringValue
        case kAXButtonRole, NSAccessibility.Role.link.rawValue, kAXMenuButtonRole:
            value = nil
        default:
            return nil
        }
        let name = shortText(attribute(node, kAXTitleAttribute)) ?? shortText(attribute(node, kAXDescriptionAttribute))
        guard name != nil || value != nil else { return nil }
        return WindowAXNode(role: role, name: name == value ? nil : name, value: value)
    }

    private func shortText(_ raw: CFTypeRef?) -> String? {
        guard let text = raw as? String, text.utf16.count <= 512,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    private func visibleText(_ node: AXUIElement) -> String? {
        guard let raw = attribute(node, kAXVisibleCharacterRangeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        var range = CFRange()
        guard AXValueGetValue(raw as! AXValue, .cfRange, &range), range.location >= 0, range.length > 0 else { return nil }
        range.length = min(range.length, 512)
        guard let parameter = AXValueCreate(.cfRange, &range) else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(node, kAXStringForRangeParameterizedAttribute as CFString, parameter, &value) == .success else { return nil }
        return shortText(value)
    }

    private func elements(_ element: AXUIElement, _ name: String, limit: Int, requireAll: Bool = false) -> [AXUIElement]? {
        var count = 0
        guard AXUIElementGetAttributeValueCount(element, name as CFString, &count) == .success,
              count >= 0, !requireAll || count <= limit else { return nil }
        if count == 0 { return attribute(element, name) == nil ? nil : [] }
        var result: CFArray?
        guard AXUIElementCopyAttributeValues(element, name as CFString, 0, min(count, limit), &result) == .success,
              let items = result as? [AXUIElement], items.count == min(count, limit) else { return nil }
        return items
    }

}

private struct CaptureWindow: Equatable {
    let id: CGWindowID
    let pid: pid_t
    let frame: CGRect

    static func onScreen() -> [CaptureWindow] {
        let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return rows.compactMap { row in
            guard (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  ((row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0) > 0,
                  let id = (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  let pid = (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid != getpid(),
                  let data = row[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: data as CFDictionary), !frame.isEmpty else { return nil }
            return CaptureWindow(id: id, pid: pid, frame: frame)
        }
    }

    @MainActor
    static func frontmost() -> CaptureWindow? {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return nil }
        let windows = onScreen().filter { $0.pid == pid }
        if windows.count == 1 { return windows.first }
        guard windows.count > 1, AXIsProcessTrusted() else { return nil }
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.075)
        let app = AXUIElementCreateApplication(pid)
        guard let focused = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
        let window = focused as! AXUIElement
        guard owner(window) == pid, let frame = bounds(window) else { return nil }
        let matches = windows.filter { $0.frame == frame }
        return matches.count == 1 ? matches.first : nil
    }
}

private enum CaptureSelection {
    case window(CaptureWindow)
    case region(CGDirectDisplayID, CGRect, displayBounds: CGRect)
}

private final class CapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
private final class CapturePicker {
    private var windows = CaptureWindow.onScreen()
    private var panels: [CapturePanel] = []
    private var continuation: CheckedContinuation<CaptureSelection?, Never>?
    private var start: CGPoint?
    private var region: CGRect?

    func choose() async -> CaptureSelection? {
        let selection = await withCheckedContinuation { continuation in
            self.continuation = continuation
            for screen in NSScreen.screens {
                guard let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else { continue }
                let panel = CapturePanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
                let shade = CaptureShade(display: id, picker: self)
                panel.contentView = shade
                panel.isOpaque = false
                panel.backgroundColor = .clear
                panel.hasShadow = false
                panel.level = .screenSaver
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
                panel.acceptsMouseMovedEvents = true
                panel.setFrame(screen.frame, display: true)
                panel.orderFrontRegardless()
                panels.append(panel)
            }
            let mouse = NSEvent.mouseLocation
            guard let panel = panels.first(where: { $0.frame.contains(mouse) }) ?? panels.first,
                  let shade = panel.contentView as? CaptureShade else { return finish(nil) }
            panel.makeFirstResponder(shade)
            panel.makeKey()
            move(shade.point(panel.convertPoint(fromScreen: mouse)), on: shade)
        }
        for panel in panels { panel.orderOut(nil) }
        return selection
    }

    func begin(_ point: CGPoint) { start = point }

    func move(_ point: CGPoint, on shade: CaptureShade) {
        if let start {
            let dx = point.x - start.x, dy = point.y - start.y
            if region != nil || max(abs(dx), abs(dy)) >= 4 {
                let rect = CGRect(x: min(point.x, start.x), y: min(point.y, start.y), width: abs(dx), height: abs(dy))
                // shortcut: Clip to the starting display until cross-display capture is needed.
                region = rect.integral.intersection(shade.displayBounds)
                show(region)
            }
        } else if let index = windows.firstIndex(where: { $0.frame.contains(point) }) {
            show(windows[index].frame, coveredBy: windows[..<index].map(\.frame))
        } else {
            show(nil)
        }
    }

    func end(_ point: CGPoint, on shade: CaptureShade) {
        move(point, on: shade)
        let start = self.start, region = self.region
        self.start = nil
        self.region = nil
        if let region {
            if region.width >= 4, region.height >= 4 {
                finish(.region(shade.display, region, displayBounds: shade.displayBounds))
                return
            }
        } else if let start {
            let window = windows.first(where: { $0.frame.contains(start) })
            windows = CaptureWindow.onScreen()
            if let window, windows.first(where: { $0.frame.contains(start) }) == window {
                finish(.window(window))
                return
            }
        }
        move(point, on: shade)
    }

    func finish(_ selection: CaptureSelection?) {
        continuation?.resume(returning: selection)
        continuation = nil
    }

    private func show(_ rect: CGRect?, coveredBy: [CGRect] = []) {
        for panel in panels {
            guard let shade = panel.contentView as? CaptureShade,
                  shade.highlight != rect || shade.coveredBy != coveredBy else { continue }
            let dirty = (shade.highlight ?? .null).union(rect ?? .null).intersection(shade.displayBounds)
            shade.highlight = rect
            shade.coveredBy = coveredBy
            guard !dirty.isEmpty else { continue }
            shade.setNeedsDisplay(dirty.offsetBy(dx: -shade.displayBounds.minX, dy: -shade.displayBounds.minY))
        }
    }
}

private final class CaptureShade: NSView {
    let display: CGDirectDisplayID
    let displayBounds: CGRect
    var highlight: CGRect?
    var coveredBy: [CGRect] = []
    private weak var picker: CapturePicker?

    init(display: CGDirectDisplayID, picker: CapturePicker) {
        self.display = display
        self.displayBounds = CGDisplayBounds(display)
        self.picker = picker
        super.init(frame: .zero)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.inVisibleRect, .activeAlways, .mouseMoved, .mouseEnteredAndExited], owner: self))
    }

    required init?(coder: NSCoder) { return nil }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
    override func mouseEntered(with event: NSEvent) { mouseMoved(with: event) }
    override func mouseMoved(with event: NSEvent) { picker?.move(point(event.locationInWindow), on: self) }
    override func mouseDown(with event: NSEvent) { picker?.begin(point(event.locationInWindow)) }
    override func mouseDragged(with event: NSEvent) { mouseMoved(with: event) }
    override func mouseUp(with event: NSEvent) { picker?.end(point(event.locationInWindow), on: self) }
    override func cancelOperation(_ sender: Any?) { picker?.finish(nil) }
    override func keyDown(with event: NSEvent) { if event.keyCode == 53 { cancelOperation(nil) } }

    func point(_ locationInWindow: CGPoint) -> CGPoint {
        let local = convert(locationInWindow, from: nil)
        return CGPoint(x: local.x + displayBounds.minX, y: local.y + displayBounds.minY)
    }

    override func draw(_ dirtyRect: CGRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let shade = CGColor(gray: 0, alpha: 0.55)
        context.setBlendMode(.copy)
        context.setFillColor(shade)
        context.fill(dirtyRect)
        guard let highlight, !highlight.isEmpty else { return }
        let rect = highlight.offsetBy(dx: -displayBounds.minX, dy: -displayBounds.minY)
        // Keep the bright area clickable through the transparent panel.
        context.setFillColor(CGColor(gray: 0, alpha: 0.01))
        context.fill(rect)
        context.setBlendMode(.normal)
        context.setStrokeColor(CGColor(gray: 1, alpha: 0.85))
        context.stroke(rect.insetBy(dx: 0.5, dy: 0.5), width: 1)
        context.setBlendMode(.copy)
        context.setFillColor(shade)
        for cover in coveredBy where cover.intersects(highlight) {
            context.fill(cover.intersection(highlight).offsetBy(dx: -displayBounds.minX, dy: -displayBounds.minY))
        }
    }
}

@available(macOS 14.0, *)
@MainActor
private final class WindowCapture: NSObject, SCContentSharingPickerObserver, SCStreamOutput, SCStreamDelegate {
    private var selected = false
    private var activeStream: SCStream?
    private var receivedFrame = false
    private var axWindow: SelectedWindowAX?
    private var placement: CGRect?
    private let maxPixels = 40_000_000

    func start(select: Bool) async {
        if CGPreflightScreenCaptureAccess() {
            if !select, let target = CaptureWindow.frontmost(), await capture(.window(target), requireFrontmost: true) { return }
            guard let selection = await CapturePicker().choose() else { Result(kind: "cancelled").send() }
            guard await capture(selection) else { Result(kind: "unavailable").send() }
            return
        }
        guard select else { Result(kind: "permission-required").send() }
        let picker = SCContentSharingPicker.shared
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = .singleWindow
        configuration.allowsChangingSelectedContent = false
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        picker.present(using: .window)
    }

    private func capture(_ selection: CaptureSelection, requireFrontmost: Bool = false) async -> Bool {
        guard CGPreflightScreenCaptureAccess() else { Result(kind: requireFrontmost ? "permission-required" : "unavailable").send() }
        guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        else { Result(kind: "unavailable").send() }
        switch selection {
        case .window(let target):
            guard let window = content.windows.first(where: {
                $0.windowID == target.id && $0.owningApplication?.processID == target.pid && $0.frame == target.frame && $0.isOnScreen
            }) else { return false }
            if requireFrontmost, CaptureWindow.frontmost() != target { return false }
            await capture(SCContentFilter(desktopIndependentWindow: window), window: window)
        case .region(let id, let rect, let bounds):
            guard let display = content.displays.first(where: { $0.displayID == id }),
                  display.frame == bounds, bounds.contains(rect) else { return false }
            let overlays = content.windows.filter { $0.owningApplication?.processID == getpid() }
            let filter = SCContentFilter(display: display, excludingWindows: overlays)
            await capture(filter, window: nil, sourceRect: rect.offsetBy(dx: -bounds.minX, dy: -bounds.minY), regionBounds: rect)
        }
        return true
    }

    private func capture(_ filter: SCContentFilter, window: SCWindow?, sourceRect: CGRect? = nil, regionBounds: CGRect? = nil) async {
        placement = regionBounds ?? window?.frame
        if AXIsProcessTrusted(), let window, let pid = window.owningApplication?.processID, pid > 0, let title = window.title {
            axWindow = SelectedWindowAX(id: window.windowID, pid: pid, frame: window.frame, title: title)
        }
        let rect = sourceRect ?? filter.contentRect
        let width = (rect.width * CGFloat(filter.pointPixelScale)).rounded()
        let height = (rect.height * CGFloat(filter.pointPixelScale)).rounded()
        guard width > 0, height > 0 else { Result(kind: "unavailable").send() }
        guard width * height <= Double(maxPixels) else { Result(kind: "too-large").send() }
        let configuration = SCStreamConfiguration()
        configuration.width = Int(width)
        configuration.height = Int(height)
        if let sourceRect { configuration.sourceRect = sourceRect }
        configuration.ignoreShadowsSingleWindow = true
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        if #available(macOS 14.2, *) { configuration.includeChildWindows = false }
        if #available(macOS 15.0, *) { configuration.captureMicrophone = false }
        // The same stream also works with the system picker's scoped grant.
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        activeStream = stream
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            if self.activeStream === stream { Result(kind: "unavailable").send() }
        }
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
            try await stream.startCapture()
        } catch { Result(kind: "unavailable").send() }
    }

    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        MainActor.assumeIsolated {
            guard activeStream === stream, !receivedFrame, type == .screen, sampleBuffer.isValid,
                  let info = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let status = info.first?[.status] as? Int, SCFrameStatus(rawValue: status) == .complete,
                  let buffer = sampleBuffer.imageBuffer else { return }
            receivedFrame = true
            let axDeadline = DispatchTime.now() + .milliseconds(600)
            let frame = CIImage(cvPixelBuffer: buffer)
            guard frame.extent.width * frame.extent.height <= CGFloat(maxPixels) else { Result(kind: "too-large").send() }
            guard let image = CIContext().createCGImage(frame, from: frame.extent) else { Result(kind: "unavailable").send() }
            Task {
                do { try await stream.stopCapture() }
                catch { Result(kind: "unavailable").send() }
                activeStream = nil
                sendImage(image, axDeadline: axDeadline)
            }
        }
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in
            if activeStream === stream { Result(kind: "unavailable").send() }
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        Task { @MainActor in
            guard !selected else { return }
            selected = true
            guard filter.style == .window else { Result(kind: "unavailable").send() }
            var window: SCWindow?
            if #available(macOS 15.2, *) {
                guard filter.includedWindows.count == 1 else { Result(kind: "unavailable").send() }
                window = filter.includedWindows.first
            }
            await capture(filter, window: window)
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in
            if !selected { Result(kind: "cancelled").send() }
        }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor in
            if !selected { Result(kind: "unavailable").send() }
        }
    }

    private func sendImage(_ image: CGImage, axDeadline: DispatchTime) {
        guard image.width * image.height <= maxPixels else { Result(kind: "too-large").send() }
        let bytes = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(bytes, UTType.png.identifier as CFString, 1, nil)
        else { Result(kind: "unavailable").send() }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { Result(kind: "unavailable").send() }
        guard bytes.length <= 8 * 1024 * 1024 else { Result(kind: "too-large").send() }
        let bounds = placement.map { [$0.minX, $0.minY, $0.width, $0.height].map { Int($0.rounded()) } }
        let result = Result(kind: "image", png: bytes as Data, width: image.width, height: image.height, bounds: bounds)
        guard let axWindow, DispatchTime.now() < axDeadline else { result.send() }
        DispatchQueue.main.asyncAfter(deadline: axDeadline) { result.send() }
        DispatchQueue.global(qos: .userInitiated).async {
            let ax = axWindow.read(before: axDeadline)
            DispatchQueue.main.async {
                var response = result
                response.ax = DispatchTime.now() < axDeadline ? ax : nil
                response.send()
            }
        }
    }
}

@main
enum CaptureMain {
    @MainActor
    static func main() {
        guard #available(macOS 14.0, *) else { Result(kind: "unavailable").send() }
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.isEmpty || arguments == ["--select"] else { Result(kind: "unavailable").send() }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let capture = WindowCapture()
        Task { await capture.start(select: !arguments.isEmpty) }
        withExtendedLifetime(capture) { app.run() }
    }
}
