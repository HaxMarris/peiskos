import UIKit
import Capacitor
import MediaPlayer
import UserNotifications

/// The app's page, with Peiskos's own native pieces added to it.
class PeiskosBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VoiceCallPlugin())
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
