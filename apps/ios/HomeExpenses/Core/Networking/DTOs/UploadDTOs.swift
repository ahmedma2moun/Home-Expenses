import Foundation

struct UploadFileRequest: Encodable, Sendable {
    let mimeType: String
    let bytes: Int
}

struct UploadTokenRequest: Encodable, Sendable {
    let files: [UploadFileRequest]
}

struct UploadTarget: Decodable, Sendable {
    let blobKey: String
    let uploadUrl: String
    let expiresAt: String
}

struct UploadTokenResponse: Decodable, Sendable {
    let targets: [UploadTarget]
}
