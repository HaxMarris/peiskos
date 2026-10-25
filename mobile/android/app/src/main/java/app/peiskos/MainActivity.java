package app.peiskos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceCallPlugin.class);
        registerPlugin(SharePlugin.class);
        registerPlugin(AlertsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
