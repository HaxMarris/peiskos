import ActivityKit
import AppIntents
import SwiftUI
import UIKit
import WidgetKit

/// Draws the voice call Peiskos shows while you're at a fire: on the lock screen, in Notification
/// Center and in the Dynamic Island, with buttons for where the sound plays and mute.
@main
struct CallActivityBundle: WidgetBundle {
    var body: some Widget {
        CallActivityWidget()
    }
}

private let ember = Color(red: 0.94, green: 0.54, blue: 0.29)
private let char = Color(red: 0.11, green: 0.09, blue: 0.07)

struct CallActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CallAttributes.self) { context in
            HStack(spacing: 14) {
                HearthIcon(attributes: context.attributes, size: 48)
                Names(state: context.state)
                Spacer(minLength: 8)
                OutputButton(output: context.state.output, size: 48)
                MuteButton(muted: context.state.muted, size: 48)
            }
            .padding(16)
            .activityBackgroundTint(char)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: "peiskos://call"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HearthIcon(attributes: context.attributes, size: 44)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 10) {
                        OutputButton(output: context.state.output, size: 44)
                        MuteButton(muted: context.state.muted, size: 44)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Names(state: context.state)
                }
            } compactLeading: {
                HearthIcon(attributes: context.attributes, size: 24)
            } compactTrailing: {
                Image(systemName: context.state.muted ? "mic.slash.fill" : "mic.fill")
                    .foregroundColor(context.state.muted ? ember : .white)
            } minimal: {
                Image(systemName: context.state.muted ? "mic.slash.fill" : "mic.fill")
                    .foregroundColor(context.state.muted ? ember : .white)
            }
            .widgetURL(URL(string: "peiskos://call"))
        }
    }
}

private struct Names: View {
    let state: CallAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(state.title)
                .font(.headline)
                .foregroundColor(.white)
                .lineLimit(1)
            Text(state.room)
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.65))
                .lineLimit(1)
        }
    }
}

private struct HearthIcon: View {
    let attributes: CallAttributes
    let size: CGFloat

    var body: some View {
        Group {
            if let data = attributes.icon, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ZStack {
                    ember
                    Text(attributes.initial)
                        .font(.system(size: size * 0.45, weight: .bold, design: .rounded))
                        .foregroundColor(char)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
    }
}

/// Opens Peiskos with the list of places the sound can play (speaker, AirPods, the car...).
private struct OutputButton: View {
    let output: String
    let size: CGFloat

    private var symbol: String {
        switch output {
        case "phone": return "iphone"
        case "headphones", "bluetooth": return "headphones"
        case "car": return "car.fill"
        case "airplay": return "airplayaudio"
        default: return "speaker.wave.2.fill"
        }
    }

    var body: some View {
        Link(destination: URL(string: "peiskos://output")!) {
            RoundButton(size: size, fill: .white) {
                Image(systemName: symbol).foregroundColor(char)
            }
        }
        .accessibilityLabel("Choose where sound plays")
    }
}

private struct MuteButton: View {
    let muted: Bool
    let size: CGFloat

    private var face: some View {
        RoundButton(size: size, fill: muted ? ember : Color.white.opacity(0.16)) {
            Image(systemName: muted ? "mic.slash.fill" : "mic.fill").foregroundColor(muted ? char : .white)
        }
    }

    var body: some View {
        Group {
            if #available(iOS 17.0, *) {
                Button(intent: ToggleMuteIntent()) { face }.buttonStyle(.plain)
            } else {
                Link(destination: URL(string: "peiskos://mute")!) { face }
            }
        }
        .accessibilityLabel(muted ? "Unmute" : "Mute")
    }
}

private struct RoundButton<Content: View>: View {
    let size: CGFloat
    let fill: Color
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            Circle().fill(fill)
            content().font(.system(size: size * 0.4, weight: .semibold))
        }
        .frame(width: size, height: size)
    }
}
