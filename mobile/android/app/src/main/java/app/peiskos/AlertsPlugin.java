package app.peiskos;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Whether this build can get alerts while Peiskos is closed. Those come through Google's Firebase,
 * which is only built in when the release had google-services.json (see mobile/README.md); without
 * it, asking Firebase for a token would crash the app.
 */
@CapacitorPlugin(name = "Alerts")
public class AlertsPlugin extends Plugin {
    @PluginMethod
    public void ready(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("ready", id != 0);
        call.resolve(result);
    }
}
