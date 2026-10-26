package app.peiskos;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * Keeps a voice call going while Peiskos is in the background or the screen is off. Android stops
 * an app's microphone soon after it leaves the screen unless it shows an ongoing notification, so
 * the page calls start() when you join a fire and stop() when you leave.
 */
@CapacitorPlugin(
    name = "VoiceCall",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        // Without it, Bluetooth headsets play the call but their microphone isn't used.
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class VoiceCallPlugin extends Plugin {
    static VoiceCallPlugin current;

    @Override
    public void load() {
        current = this;
        if (Build.VERSION.SDK_INT >= 31) {
            audio().addOnCommunicationDeviceChangedListener(ContextCompat.getMainExecutor(getContext()), (device) -> reportOutput());
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        List<String> ask = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) ask.add("notifications");
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") == PermissionState.PROMPT) ask.add("bluetooth");
        if (!ask.isEmpty()) {
            requestPermissionForAliases(ask.toArray(new String[0]), call, "afterPermissions");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        // Answered either way: the call works without them, just without the notification or headset mic.
        startService(call);
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), VoiceCallService.class);
        intent.putExtra("title", call.getString("title", "In a voice room"));
        intent.putExtra("text", call.getString("text", "Peiskos"));
        intent.putExtra("muted", Boolean.TRUE.equals(call.getBoolean("muted", false)));
        try {
            // Android only lets an app start a foreground service while it's on screen, but the page also
            // calls this from the background (muting, getting back in after the connection drops). The
            // service is already running then, and a plain start just redraws its notification.
            if (VoiceCallService.running) getContext().startService(intent);
            else ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't keep the call going in the background", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), VoiceCallService.class));
        call.resolve();
    }

    /** Lists the places the call can play (the phone, its speaker, a headset) and switches to the one picked. */
    @PluginMethod
    public void pickOutput(PluginCall call) {
        AudioManager audio = audio();
        if (Build.VERSION.SDK_INT < 31) {
            // Older Androids can only switch between the loudspeaker and the usual place.
            audio.setSpeakerphoneOn(!audio.isSpeakerphoneOn());
            reportOutput();
            call.resolve();
            return;
        }
        List<AudioDeviceInfo> devices = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
            String name = deviceName(device);
            if (names.contains(name)) continue;
            devices.add(device);
            names.add(name);
        }
        AudioDeviceInfo now = audio.getCommunicationDevice();
        int checked = -1;
        for (int i = 0; i < devices.size(); i++) if (now != null && devices.get(i).getId() == now.getId()) checked = i;
        final int picked = checked;
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Play sound on")
            .setSingleChoiceItems(names.toArray(new String[0]), picked, (dialog, which) -> {
                audio.setCommunicationDevice(devices.get(which));
                dialog.dismiss();
                reportOutput();
            })
            .setNegativeButton("Cancel", null)
            .show());
        call.resolve();
    }

    @PluginMethod
    public void output(PluginCall call) {
        JSObject result = new JSObject();
        result.put("kind", outputKind());
        call.resolve(result);
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
    }

    private static String deviceName(AudioDeviceInfo device) {
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "Phone";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "Speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "Headphones";
            default:
                CharSequence name = device.getProductName();
                return name == null || name.length() == 0 ? "Headset" : name.toString();
        }
    }

    /** Where the call plays now, in the words the page uses: speaker, phone, headphones or bluetooth. */
    private String outputKind() {
        AudioManager audio = audio();
        if (Build.VERSION.SDK_INT < 31) return audio.isSpeakerphoneOn() ? "speaker" : audio.isBluetoothScoOn() ? "bluetooth" : "phone";
        AudioDeviceInfo device = audio.getCommunicationDevice();
        if (device == null) return "speaker";
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "phone";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "headphones";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: return "bluetooth";
            default: return "speaker";
        }
    }

    private void reportOutput() {
        JSObject data = new JSObject();
        data.put("kind", outputKind());
        notifyListeners("output", data);
    }

    /** "Leave" was tapped on the notification. */
    void leaveTapped() {
        notifyListeners("leave", null);
    }

    /** "Mute" or "Unmute" was tapped on the notification. */
    void muteTapped() {
        notifyListeners("mute", null);
    }
}
