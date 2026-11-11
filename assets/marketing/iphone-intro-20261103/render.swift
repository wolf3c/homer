import AppKit

// Layout only: the native screenshot is embedded whole, without retouching its content.
let base = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let size = NSSize(width: 1242, height: 2688)
let ink = NSColor(srgbRed: 0.15, green: 0.15, blue: 0.14, alpha: 1)
let muted = NSColor(srgbRed: 0.42, green: 0.41, blue: 0.39, alpha: 1)
let cards = [
    ("iphone-intro-01-clean.png", "01-continue-conversation.png", "拿起手机，", "继续对话。", "扫码连接电脑，随手查看和补充。"),
    ("iphone-intro-02-clean.png", "02-follow-up.png", "补充一句，", "接着完成。", "沿着同一段对话，把想法说清楚。")
]
for (index, card) in cards.enumerated() {
    guard let screenshot = NSImage(contentsOf: base.appendingPathComponent(card.0)),
          let cg = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("Missing source image or drawing context") }
    let context = NSGraphicsContext(cgContext: cg, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor(srgbRed: 0.965, green: 0.961, blue: 0.945, alpha: 1).setFill()
    NSRect(origin: .zero, size: size).fill()
    func text(_ value: String, _ x: CGFloat, _ top: CGFloat, _ fontSize: CGFloat, _ bold: Bool = false, _ color: NSColor = ink) {
        let font = NSFont(name: bold ? "PingFangSC-Semibold" : "PingFangSC-Regular", size: fontSize) ?? NSFont.systemFont(ofSize: fontSize)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let string = value as NSString
        let height = string.size(withAttributes: attributes).height
        string.draw(at: NSPoint(x: x, y: size.height - top - height), withAttributes: attributes)
    }
    text("Homer · 荷马", 96, 65, 30, true)
    text(String(format: "%02d / 02", index + 1), 1020, 70, 24, false, muted)
    text(card.2, 96, 142, 92, true)
    text(card.3, 96, 252, 92, true)
    text(card.4, 100, 385, 34, false, muted)
    let width: CGFloat = 900
    let height = width * screenshot.size.height / screenshot.size.width
    let frame = NSRect(x: (size.width - width) / 2, y: size.height - 492 - height, width: width, height: height)
    NSColor(srgbRed: 0.86, green: 0.85, blue: 0.82, alpha: 1).setFill()
    NSBezierPath(roundedRect: frame.insetBy(dx: -2, dy: -2), xRadius: 22, yRadius: 22).fill()
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(roundedRect: frame, xRadius: 20, yRadius: 20).addClip()
    context.imageInterpolation = .high
    screenshot.draw(in: frame, from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    text("电脑主端需保持在线", 171, 2500, 28, false, muted)
    text("iPhone 真机界面 · 示例内容", 171, 2550, 24, false, muted)
    NSGraphicsContext.restoreGraphicsState()
    guard let image = cg.makeImage(), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { fatalError("PNG export failed") }
    try png.write(to: output.appendingPathComponent(card.1))
    print("Saved \(card.1): 1242×2688, opaque RGB")
}
