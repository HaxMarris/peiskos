import UIKit
import UniformTypeIdentifiers

/// Peiskos in the iPhone's share sheet. Whatever was shared (photos, videos, files, a link or some
/// text) is copied into the folder Peiskos shares with this extension (the App Group), then Peiskos
/// opens and asks which room it goes to.
class ShareViewController: UIViewController {
    static let group = "group.app.peiskos"
    private let maxFiles = 10
    private let maxBytes = 25 * 1024 * 1024

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task {
            await save()
            openPeiskos()
            extensionContext?.completeRequest(returningItems: nil)
        }
    }

    private func save() async {
        guard let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group)?.appendingPathComponent("Shared", isDirectory: true) else { return }
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var texts: [String] = []
        var files: [[String: String]] = []
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL { texts.append(url.absoluteString) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { texts.append(text) }
            } else if files.count < maxFiles, let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) ?? provider.registeredTypeIdentifiers.first {
                if let file = await copy(provider, type: type, into: folder, number: files.count) { files.append(file) }
            }
        }
        let manifest: [String: Any] = ["text": texts.joined(separator: "\n"), "files": files]
        if let data = try? JSONSerialization.data(withJSONObject: manifest) {
            try? data.write(to: folder.appendingPathComponent("share.json"))
        }
    }

    /// Copies one shared thing into the folder, keeping its name and type.
    private func copy(_ provider: NSItemProvider, type: String, into folder: URL, number: Int) async -> [String: String]? {
        await withCheckedContinuation { done in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url = url,
                      let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= self.maxBytes else { return done.resume(returning: nil) }
                let name = provider.suggestedName.map { name in url.pathExtension.isEmpty || name.hasSuffix(".\(url.pathExtension)") ? name : "\(name).\(url.pathExtension)" } ?? url.lastPathComponent
                let saved = "file-\(number)"
                do {
                    try FileManager.default.copyItem(at: url, to: folder.appendingPathComponent(saved))
                } catch {
                    return done.resume(returning: nil)
                }
                let mime = UTType(type)?.preferredMIMEType ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                done.resume(returning: ["name": name, "type": mime, "path": saved])
            }
        }
    }

    /// Share extensions can't open apps directly, but the app they live in is up the responder chain.
    private func openPeiskos() {
        guard let url = URL(string: "peiskos://share") else { return }
        var responder: UIResponder? = self
        while let next = responder {
            if let application = next as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = next.next
        }
    }
}
