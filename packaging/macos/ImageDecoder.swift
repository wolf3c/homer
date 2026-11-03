import Foundation
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics

// A bounded stdin -> one-frame PNG transformer. No paths, URLs or metadata exit.
do {
    guard CommandLine.arguments.count == 2,
          let edge = Int(CommandLine.arguments[1]), [0, 320].contains(edge) else { exit(2) }
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 50 * 1024 * 1024,
          let source = CGImageSourceCreateWithData(input as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 40_000_000 / height else { exit(3) }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: edge == 0 ? max(width, height) : min(edge, max(width, height)),
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
          let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(4) }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let output = NSMutableData()
    guard let clean = context.makeImage(),
          let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else { exit(5) }
    CGImageDestinationAddImage(destination, clean, [:] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { exit(6) }
    FileHandle.standardOutput.write(output as Data)
}
