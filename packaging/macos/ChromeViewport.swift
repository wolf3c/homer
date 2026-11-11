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
      let pid = pid_t(args[1]), let wanted = CGWindowID(args[2]) else { exit(2) }
if let session = CGSessionCopyCurrentDictionary() as? [String: Any],
   session["CGSSessionScreenIsLocked"] as? Bool == true { exit(11) }
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 0.25)
func boundWindow() -> AXUIElement {
    guard NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.google.Chrome" else { exit(5) }
    guard AXIsProcessTrusted() else { exit(6) }
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &raw) == .success,
          let windows = raw as? [AXUIElement] else { exit(10) }
    guard let window = windows.first(where: { element in
        var id = CGWindowID(0)
        return windowID(element, &id) == .success && id == wanted
    }) else { exit(3) }
    return window
}
let window = boundWindow()

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

func viewport(_ window: AXUIElement) -> (CGRect, CGRect, URL)? {
    guard let windowFrame = frame(window) else { exit(8) }
    var budget = 150, webAreas = 0, unsupported = 0
    var matches: [(CGRect, URL)] = []
    func scan(_ element: AXUIElement, inside scrollArea: AXUIElement? = nil) {
        guard budget > 0 else { return }
        budget -= 1
        let role: String? = attribute(element, kAXRoleAttribute)
        if role == "AXWebArea" {
            webAreas += 1
            if let url: URL = attribute(element, kAXURLAttribute) {
                if url.scheme != "http" && url.scheme != "https" { unsupported += 1 }
                else if let scrollArea, let bounds = frame(element), bounds == frame(scrollArea), windowFrame.contains(bounds) {
                    matches.append((bounds, url))
                }
            }
            return // Ignore nested documents.
        }
        let children: [AXUIElement] = attribute(element, kAXChildrenAttribute) ?? []
        for child in children {
            scan(child, inside: role == "AXScrollArea" ? element : nil)
        }
    }
    scan(window)
    guard budget > 0 else { exit(8) }
    if webAreas == 0 { return nil }
    if unsupported == webAreas { exit(9) }
    guard matches.count == 1 else { exit(8) }
    return (windowFrame, matches[0].0, matches[0].1)
}
var found = viewport(window)
if found == nil {
    // Chromium debounces this request for two seconds, even when AppKit returns an error.
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    let until = ProcessInfo.processInfo.systemUptime + 3
    repeat {
        Thread.sleep(forTimeInterval: 0.1)
        found = viewport(boundWindow())
    } while found == nil && ProcessInfo.processInfo.systemUptime < until
    guard found != nil else { exit(7) }
}

struct Geometry: Encodable {
    let window: Frame
    let viewport: Frame
    let page: String
    let origin: String?
}
let (windowFrame, bounds, url) = found!
var origin = URLComponents()
origin.scheme = url.scheme
origin.percentEncodedHost = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedHost
origin.port = url.port
let encoder = JSONEncoder()
encoder.outputFormatting = .sortedKeys
FileHandle.standardOutput.write(try encoder.encode(Geometry(window: Frame(windowFrame), viewport: Frame(bounds), page: digest(url.absoluteString), origin: origin.string)))
