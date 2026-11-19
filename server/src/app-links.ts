// The two files phones read to let the Peiskos apps open this server's invite links
// (https://<server>/invite/<code>) instead of the browser: Apple's for Universal Links and
// Google's for Android App Links. Each is only served once it's set up, since a wrong one
// is worse than none.

export type AppLinksConfig = {
  /** TEAMID.bundle-id of the iPhone app, like ABCDE12345.app.peiskos. */
  appleAppId?: string;
  /** The Android app's package name. */
  androidPackage: string;
  /** SHA-256 fingerprints of the keys the Android app is signed with (Play's, and the one for the .apk). */
  androidCerts: string[];
};

/** The file asked for, as JSON text, or null if this isn't one of them (or it isn't set up). */
export function appLinkFile(pathname: string, cfg: AppLinksConfig | undefined): string | null {
  if (!cfg) return null;
  if (pathname === '/.well-known/apple-app-site-association' && cfg.appleAppId) {
    return JSON.stringify({ applinks: { details: [{ appIDs: [cfg.appleAppId], components: [{ '/': '/invite/*' }] }] } });
  }
  if (pathname === '/.well-known/assetlinks.json' && cfg.androidCerts.length) {
    return JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: cfg.androidPackage, sha256_cert_fingerprints: cfg.androidCerts },
    }]);
  }
  return null;
}

/** Fingerprints as Play Console and keytool print them (AB:CD:…), from a comma-separated list. */
export function parseCertList(text: string | undefined): string[] {
  return String(text ?? '')
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(c));
}
