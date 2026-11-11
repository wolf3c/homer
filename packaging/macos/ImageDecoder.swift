import Foundation
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics

// A bounded stdin -> one-frame PNG transformer. No paths, URLs or metadata exit.
do {
    let args = CommandLine.arguments
    let edge = args.count == 2 ? Int(args[1]) : nil
    let crop = args.count == 6 && args[1] == "crop" ? args.dropFirst(2).compactMap { Int($0) } : []
    guard edge == 0 || edge == 320 || crop.count == 4 else { exit(2) }
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 50 * 1024 * 1024,
          let source = CGImageSourceCreateWithData(input as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 40_000_000 / height else { exit(3) }
    let image: CGImage?
    if let edge {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: edge == 0 ? max(width, height) : min(edge, max(width, height)),
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true
        ]
        image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    } else {
        let (x, y, w, h) = (crop[0], crop[1], crop[2], crop[3])
        guard x >= 0, y >= 0, w > 0, h > 0, w <= width, h <= height,
              x <= width - w, y <= height - h, CGImageSourceGetType(source) == UTType.png.identifier as CFString else { exit(3) }
        image = CGImageSourceCreateImageAtIndex(source, 0, nil)?.cropping(to: CGRect(x: x, y: y, width: w, height: h))
    }
    guard let image,
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
