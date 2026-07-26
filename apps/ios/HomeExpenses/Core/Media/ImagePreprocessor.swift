import UIKit

/// Client-side pre-processing before upload (PROJECT_SPEC.md BR-1): downscale to a max 1568px
/// long edge and re-encode as JPEG q≈0.8. Re-drawing through `UIGraphicsImageRenderer` also drops
/// the original EXIF block (including GPS) since the renderer output carries no source metadata.
enum ImagePreprocessor {
    static let maxDimension: CGFloat = 1568
    static let jpegQuality: CGFloat = 0.8

    static func process(_ image: UIImage) -> Data? {
        resize(image, maxDimension: maxDimension).jpegData(compressionQuality: jpegQuality)
    }

    private static func resize(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let longestEdge = max(size.width, size.height)
        guard longestEdge > maxDimension, longestEdge > 0 else {
            return image
        }

        let scale = maxDimension / longestEdge
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
