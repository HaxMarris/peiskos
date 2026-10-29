package app.peiskos;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Photos, files and text shared to Peiskos from other apps' share menus. MainActivity hands each
 * share over; the page takes it (take()) once it's ready, or hears about it ("shared") while open.
 */
@CapacitorPlugin(name = "Share")
public class SharePlugin extends Plugin {
    private static final int MAX_FILES = 10;
    private static final long MAX_BYTES = 25L * 1024 * 1024;
    private JSObject pending;

    @Override
    public void load() {
        received(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (received(intent)) notifyListeners("shared", null);
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject share = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(share);
    }

    private boolean received(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        JSArray files = new JSArray();
        for (Uri uri : uris) {
            if (files.length() >= MAX_FILES) break;
            JSObject file = read(uri);
            if (file != null) files.put(file);
        }
        JSObject share = new JSObject();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        share.put("text", text != null ? text : "");
        share.put("files", files);
        pending = share;
        // Taken: opening Peiskos again later shouldn't share it a second time.
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }

    private JSObject read(Uri uri) {
        // Only things another app hands over (content://, from its own provider). Peiskos would
        // open a file:// path or one of its own providers with its own rights, so another app could
        // "share" Peiskos's private files (its login among them) into a message.
        String pkg = getContext().getPackageName();
        String authority = uri.getAuthority();
        if (!"content".equals(uri.getScheme()) || authority == null || authority.equals(pkg) || authority.startsWith(pkg + ".")) return null;
        ContentResolver resolver = getContext().getContentResolver();
        String name = "shared";
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0);
        } catch (Exception ignored) {}
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            for (int n; (n = in.read(buffer)) > 0; ) {
                total += n;
                if (total > MAX_BYTES) return null;
                out.write(buffer, 0, n);
            }
            JSObject file = new JSObject();
            file.put("name", name);
            String type = resolver.getType(uri);
            file.put("type", type != null ? type : "application/octet-stream");
            file.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            return file;
        } catch (Exception e) {
            return null;
        }
    }
}
