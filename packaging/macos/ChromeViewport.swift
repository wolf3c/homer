import AppKit
import ApplicationServices
import CryptoKit

// Match the WindowServer identity used by Cua Driver.
@_silgen_name("_AXUIElementGetWindow")
func windowID(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &raw) == .success else { return nil }
    return raw as? T
}

func frame(_ element: AXUIElement) -> CGRect? {
    guard let position: AXValue = attribute(element, kAXPositionAttribute),
          let size: AXValue = attribute(element, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position, .cgPoint, &point), AXValueGetValue(size, .cgSize, &dimensions),
          [point.x, point.y, dimensions.width, dimensions.height].allSatisfy(\.isFinite),
          dimensions.width > 0, dimensions.height > 0 else { return nil }
    return CGRect(origin: point, size: dimensions)
}

func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

let args = CommandLine.arguments
guard (args.count == 3 || args.count == 4 && ["address", "window"].contains(args[3])),
      let pid = pid_t(args[1]), let wanted = CGWindowID(args[2]),
      NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.google.Chrome",
      AXIsProcessTrusted() else { exit(2) }
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 0.25)
let windows: [AXUIElement] = attribute(app, kAXWindowsAttribute) ?? []
guard let window = windows.first(where: { element in
    var id = CGWindowID(0)
    return windowID(element, &id) == .success && id == wanted
}) else { exit(3) }

if args.count == 4 {
    if args[3] == "window" { exit(0) }
    guard let focus: AXUIElement = attribute(app, kAXFocusedUIElementAttribute),
          (attribute(focus, kAXRoleAttribute) as String?) == "AXTextField" else { exit(4) }
    var ancestor: AXUIElement? = focus
    var toolbar = false
    for _ in 0..<16 {
        guard let element = ancestor else { break }
        if CFEqual(element, window) {
            guard toolbar, let value: String = attribute(focus, kAXValueAttribute) else { exit(4) }
            print(digest(value))
            exit(0)
        }
        toolbar = toolbar || (attribute(element, kAXRoleAttribute) as String?) == "AXToolbar"
        ancestor = attribute(element, kAXParentAttribute)
    }
    exit(4)
}

struct Frame: Encodable {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat

    init(_ rect: CGRect) {
        (x, y, width, height) = (rect.minX, rect.minY, rect.width, rect.height)
    }
}

guard let windowFrame = frame(window) else { exit(4) }
var budget = 150
var matches: [(CGRect, URL)] = []
func findViewport(_ element: AXUIElement, inside scrollArea: AXUIElement? = nil) {
    guard budget > 0 else { return }
    budget -= 1
    let role: String? = attribute(element, kAXRoleAttribute)
    if role == "AXWebArea" {
        if let scrollArea, let bounds = frame(element), bounds == frame(scrollArea),
           windowFrame.contains(bounds), let url: URL = attribute(element, kAXURLAttribute),
           url.scheme == "http" || url.scheme == "https" {
            matches.append((bounds, url))
        }
        return // Ignore nested documents.
    }
    let children: [AXUIElement] = attribute(element, kAXChildrenAttribute) ?? []
    for child in children {
        findViewport(child, inside: role == "AXScrollArea" ? element : nil)
    }
}
findViewport(window)
guard budget > 0, matches.count == 1 else { exit(4) }

struct Geometry: Encodable {
    let window: Frame
    let viewport: Frame
    let page: String
    let origin: String?
}
let (bounds, url) = matches[0]
var origin = URLComponents()
origin.scheme = url.scheme
origin.percentEncodedHost = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedHost
origin.port = url.port
let encoder = JSONEncoder()
encoder.outputFormatting = .sortedKeys
FileHandle.standardOutput.write(try encoder.encode(Geometry(window: Frame(windowFrame), viewport: Frame(bounds), page: digest(url.absoluteString), origin: origin.string)))
