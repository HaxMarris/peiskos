import ActivityKit
import AppIntents
import Foundation

/// A voice call shown as a Live Activity (lock screen and Dynamic Island). Peiskos starts and
/// updates it (PeiskosNative.swift); the CallActivity extension draws it. Both build this file.
@available(iOS 16.1, *)
struct CallAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// The hearth, or who you're calling.
        var title: String
        /// The fire you're at.
        var room: String
        var muted: Bool
        /// Where the sound plays: speaker, phone, headphones, bluetooth, car or airplay.
        var output: String
    }

    /// The hearth's picture as a small JPEG (a Live Activity can only carry a few KB), if it has one.
    var icon: Data?
    /// Shown instead of a picture.
    var initial: String
}

extension Notification.Name {
    /// A button on the call was pressed: "mute" or "output".
    static let peiskosCallAction = Notification.Name("PeiskosCallAction")
}

/// The call's mute button. It runs inside Peiskos itself, which keeps running during a call.
@available(iOS 17.0, *)
struct ToggleMuteIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Mute or unmute"

    func perform() async throws -> some IntentResult {
        await MainActor.run { NotificationCenter.default.post(name: .peiskosCallAction, object: "mute") }
        return .result()
    }
}
