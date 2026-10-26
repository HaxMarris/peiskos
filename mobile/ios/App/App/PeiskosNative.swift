import UIKit
import Capacitor
import MediaPlayer
import UserNotifications
import WebKit

/// The app's page, with Peiskos's own native pieces added to it.
class PeiskosBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VoiceCallPlugin())
        bridge?.registerPluginInstance(SharePlugin())
    }

    // iOS slows a page down once it's off screen, so with Peiskos in the background or the phone
    // locked, the voices coming in arrived late and crackled. During a call the app stays awake
    // anyway (background audio), so let the page keep its full speed; without a call, iOS still
    // suspends the whole app a little after it leaves the screen.
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        if #available(iOS 17.0, *) { configuration.preferences.inactiveSchedulingPolicy = .none }
        return configuration
    }
}

/// Shows a voice call on the lock screen while you're in a fire, with Mute and Leave: as the
/// "now playing" controls (play/pause is mute), and as a quiet notification when Peiskos goes to
/// the background (press and hold it for Mute and Leave). The page calls start() when you join
/// or your mute changes, and stop() when you leave; taps come back as "mute" and "leave".
@objc(VoiceCallPlugin)
public class VoiceCallPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "VoiceCallPlugin"
    public let jsName = "VoiceCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private static let notificationId = "voice-call"
    private var current: (title: String, text: String, muted: Bool)?
    private var commandTargets: [Any] = []

    override public func load() {
        bridge?.notificationRouter.localNotificationHandler = self
        let leave = UNNotificationAction(identifier: "leave", title: "Leave", options: [.destructive])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "voice", actions: [UNNotificationAction(identifier: "mute", title: "Mute", options: []), leave], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "voice-muted", actions: [UNNotificationAction(identifier: "mute", title: "Unmute", options: []), leave], intentIdentifiers: [], options: [])
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(wentToBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(cameBack), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc func start(_ call: CAPPluginCall) {
        let next = (title: call.getString("title") ?? "In a voice room", text: call.getString("text") ?? "Peiskos", muted: call.getBool("muted") ?? false)
        DispatchQueue.main.async {
            self.current = next
            self.showOnLockScreen()
            if UIApplication.shared.applicationState == .background { self.postNotification() }
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.current = nil
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self.removeCommands()
            self.removeNotification()
        }
        call.resolve()
    }

    private func showOnLockScreen() {
        guard let call = current else { return }
        let info: [String: Any] = [
            MPMediaItemPropertyTitle: call.title,
            MPMediaItemPropertyArtist: call.muted ? "Muted · \(call.text)" : call.text,
            MPNowPlayingInfoPropertyPlaybackRate: call.muted ? 0.0 : 1.0,
            MPNowPlayingInfoPropertyIsLiveStream: true
        ]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        guard commandTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        // Paused means muted, so play/pause is the mute button.
        commandTargets = [
            center.togglePlayPauseCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
                self?.tapped("mute")
                return .success
            },
            center.pauseCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
                if self?.current?.muted == false { self?.tapped("mute") }
                return .success
            },
            center.playCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
                if self?.current?.muted == true { self?.tapped("mute") }
                return .success
            }
        ]
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }

    private func removeCommands() {
        let center = MPRemoteCommandCenter.shared()
        for target in commandTargets {
            center.togglePlayPauseCommand.removeTarget(target)
            center.pauseCommand.removeTarget(target)
            center.playCommand.removeTarget(target)
        }
        commandTargets = []
    }

    @objc private func wentToBackground() {
        postNotification()
    }

    @objc private func cameBack() {
        removeNotification()
    }

    private func postNotification() {
        guard let call = current else { return }
        let content = UNMutableNotificationContent()
        content.title = call.title
        content.body = call.muted ? "You're muted. Press and hold to unmute or leave." : "Press and hold to mute or leave."
        content.categoryIdentifier = call.muted ? "voice-muted" : "voice"
        if #available(iOS 15.0, *) { content.interruptionLevel = .passive }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: Self.notificationId, content: content, trigger: nil))
    }

    private func removeNotification() {
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [Self.notificationId])
        center.removePendingNotificationRequests(withIdentifiers: [Self.notificationId])
    }

    private func tapped(_ event: String) {
        notifyListeners(event, data: [:])
    }

    // The call notification's buttons. (Alerts from the server go to the push plugin instead.)
    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        return []
    }

    public func didReceive(response: UNNotificationResponse) {
        guard response.notification.request.identifier == Self.notificationId else { return }
        if response.actionIdentifier == "mute" || response.actionIdentifier == "leave" { tapped(response.actionIdentifier) }
    }
}

/// What was shared to Peiskos from another app's share sheet. The share extension
/// (ShareExtension/) leaves it in the folder the two share; the page takes it with take(), and
/// hears "shared" when Peiskos comes back to the front with something waiting.
@objc(SharePlugin)
public class SharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharePlugin"
    public let jsName = "Share"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)
    ]

    private var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.peiskos")?.appendingPathComponent("Shared", isDirectory: true)
    }

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(cameToFront), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func cameToFront() {
        if let folder = folder, FileManager.default.fileExists(atPath: folder.appendingPathComponent("share.json").path) {
            notifyListeners("shared", data: [:])
        }
    }

    @objc func take(_ call: CAPPluginCall) {
        guard let folder = folder,
              let data = try? Data(contentsOf: folder.appendingPathComponent("share.json")),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return call.resolve([:])
        }
        var files: [[String: String]] = []
        for file in manifest["files"] as? [[String: String]] ?? [] {
            guard let path = file["path"], let bytes = try? Data(contentsOf: folder.appendingPathComponent(path)) else { continue }
            files.append(["name": file["name"] ?? "shared", "type": file["type"] ?? "application/octet-stream", "data": bytes.base64EncodedString()])
        }
        // Taken: it isn't offered again.
        try? FileManager.default.removeItem(at: folder)
        call.resolve(["text": manifest["text"] as? String ?? "", "files": files])
    }
}
