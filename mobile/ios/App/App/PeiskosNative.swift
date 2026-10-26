import ActivityKit
import AVKit
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

/// Shows a voice call while you're at a fire. Where it can (iOS 16.2 and up, Live Activities on),
/// it's a Live Activity on the lock screen and in the Dynamic Island, with buttons for where the
/// sound plays and mute (CallActivity/). Otherwise it's the "now playing" controls (play/pause is
/// mute) and a quiet notification when Peiskos goes to the background (press and hold it for Mute
/// and Leave). The page calls start() when you join or anything about the call changes, and stop()
/// when you leave; taps come back as "mute" and "leave", and "output" says where sound plays now.
@objc(VoiceCallPlugin)
public class VoiceCallPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "VoiceCallPlugin"
    public let jsName = "VoiceCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickOutput", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "output", returnType: CAPPluginReturnPromise)
    ]

    private struct Call {
        var title: String, text: String, room: String, muted: Bool
        var key: String, icon: Data?, initial: String
    }

    private static let notificationId = "voice-call"
    private var current: Call?
    private var commandTargets: [Any] = []
    /// The Live Activity showing the call, when there is one (an Activity<CallAttributes>).
    private var activity: Any?
    private var activityKey: String?
    /// Kept on the page, out of sight, so its list can be opened from a button.
    private lazy var routePicker: AVRoutePickerView = {
        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        picker.alpha = 0.011
        picker.isUserInteractionEnabled = false
        return picker
    }()

    override public func load() {
        bridge?.notificationRouter.localNotificationHandler = self
        let leave = UNNotificationAction(identifier: "leave", title: "Leave", options: [.destructive])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "voice", actions: [UNNotificationAction(identifier: "mute", title: "Mute", options: []), leave], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "voice-muted", actions: [UNNotificationAction(identifier: "mute", title: "Unmute", options: []), leave], intentIdentifiers: [], options: [])
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(wentToBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(cameBack), name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(callAction(_:)), name: .peiskosCallAction, object: nil)
        // A call left on screen by a Peiskos that was closed mid-call.
        if #available(iOS 16.2, *) { endLiveActivities() }
    }

    @objc func start(_ call: CAPPluginCall) {
        var icon: Data?
        if let base64 = call.getString("icon"), !base64.isEmpty { icon = Data(base64Encoded: base64) }
        let text = call.getString("text") ?? "Peiskos"
        let next = Call(
            title: call.getString("title") ?? "In a voice room", text: text, room: call.getString("room") ?? "",
            muted: call.getBool("muted") ?? false, key: call.getString("key") ?? text,
            icon: icon, initial: call.getString("initial") ?? String(text.prefix(1)).uppercased()
        )
        DispatchQueue.main.async {
            self.current = next
            if #available(iOS 16.2, *), self.showLiveActivity() { return }
            self.showOnLockScreen()
            if UIApplication.shared.applicationState == .background { self.postNotification() }
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.current = nil
            if #available(iOS 16.2, *) { self.endLiveActivities() }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self.removeCommands()
            self.removeNotification()
        }
        call.resolve()
    }

    /// Opens the list of places the sound can play: the phone, its speaker, AirPods, the car...
    @objc func pickOutput(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.showRoutePicker()
            call.resolve()
        }
    }

    @objc func output(_ call: CAPPluginCall) {
        call.resolve(["kind": Self.outputKind()])
    }

    /// Where the sound plays now, in the words the page and the Live Activity use.
    private static func outputKind() -> String {
        switch AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType {
        case .builtInReceiver?: return "phone"
        case .headphones?, .usbAudio?: return "headphones"
        case .bluetoothA2DP?, .bluetoothHFP?, .bluetoothLE?: return "bluetooth"
        case .carAudio?: return "car"
        case .airPlay?: return "airplay"
        default: return "speaker"
        }
    }

    private func showRoutePicker() {
        guard let view = bridge?.viewController?.view else { return }
        if routePicker.superview !== view { view.addSubview(routePicker) }
        let button = routePicker.subviews.compactMap { $0 as? UIButton }.first
        button?.sendActions(for: .touchUpInside)
    }

    @objc private func routeChanged() {
        DispatchQueue.main.async {
            self.notifyListeners("output", data: ["kind": Self.outputKind()])
            if #available(iOS 16.2, *), self.current != nil { _ = self.showLiveActivity() }
        }
    }

    /// A button on the Live Activity (or a peiskos:// link from it, before iOS 17).
    @objc private func callAction(_ note: Notification) {
        guard let action = note.object as? String else { return }
        DispatchQueue.main.async {
            if action == "mute" { self.tapped("mute") }
            // Peiskos was just opened for this, so give it a moment to come to the front.
            if action == "output" { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.showRoutePicker() } }
        }
    }

    /// Shows or updates the call as a Live Activity. False if Live Activities are off for Peiskos.
    @available(iOS 16.2, *)
    private func showLiveActivity() -> Bool {
        guard let call = current, ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        let state = CallAttributes.ContentState(title: call.text, room: call.room, muted: call.muted, output: Self.outputKind())
        let content = ActivityContent(state: state, staleDate: nil)
        if let running = activity as? Activity<CallAttributes>, activityKey == call.key {
            Task { await running.update(content) }
            return true
        }
        // Another hearth: its picture is part of the activity, so start a new one.
        endLiveActivities()
        do {
            activity = try Activity.request(attributes: CallAttributes(icon: call.icon, initial: call.initial), content: content, pushType: nil)
            activityKey = call.key
        } catch {
            // Too big a picture is the likely reason; try without it once.
            guard call.icon != nil else { return false }
            activity = try? Activity.request(attributes: CallAttributes(icon: nil, initial: call.initial), content: content, pushType: nil)
            activityKey = activity == nil ? nil : call.key
            if activity == nil { return false }
        }
        // The Live Activity takes the place of the now playing controls and the notification.
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        removeCommands()
        removeNotification()
        return true
    }

    @available(iOS 16.2, *)
    private func endLiveActivities() {
        activity = nil
        activityKey = nil
        for running in Activity<CallAttributes>.activities {
            Task { await running.end(nil, dismissalPolicy: .immediate) }
        }
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
        if activity == nil { postNotification() }
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
