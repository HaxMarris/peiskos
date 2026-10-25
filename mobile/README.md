# Peiskos for Android and iPhone

The phone apps are the same client as the web and desktop apps (`client/`), inside a
[Capacitor](https://capacitorjs.com) app shell, the way the desktop app puts it inside Electron.
Like the desktop app they connect to `https://peiskos.app` unless you pick *Use a different server*
on the login screen.

What the app shell adds on top of the web page:

- An icon on the home screen, and Peiskos opening without a browser around it.
- Voice calls that keep going with the screen off. On Android an ongoing "In Campfire" notification
  (with a *Leave* button) shows while you're in a voice room; Android stops an app's microphone in
  the background without one. On iPhones the app is marked as one that plays sound in the
  background, which is what lets Apple's web view keep the microphone and the call's sound going with
  the screen locked (the orange dot at the top shows the mic is still on). If the phone pauses the
  sound anyway (a phone call, Siri), Peiskos starts it again as soon as it's allowed, and brings the
  microphone back when you open the app.
- Android's back button closes what's open, then goes back to the rooms, then puts Peiskos away.
- Nothing of Peiskos's goes into Android phone backups or moves to a new phone, since that would carry
  your login with it. On a new phone you log in again.

- Alerts for new messages while the app is closed: through Apple's push service on iPhones and
  Google's Firebase on Android. Each needs a key on the server (see *Phone alerts* in the main
  README), and Android also needs the Firebase file below in the build.

Not yet: screen sharing from a phone, and passkeys (log in with your password).

## Building them on GitHub

The `Mobile release` workflow (`.github/workflows/mobile-release.yml`) runs:

- **On every pull request** that changes `mobile/` or `client/`: it builds both apps to check
  they still build. The Android test build can be downloaded from the run's page under *Artifacts*.
- **For each release** (*Start release* in the Actions tab, see "Releasing a new version" in the
  main README): the Android app is attached to the release as `Peiskos-1.2.3.apk` (plus `Peiskos-1.2.3.aab`
  for the Play Store), and the iPhone
  app goes to TestFlight and is sent for Apple's review; the release is published once Apple
  approves. Each step only happens once its secrets below are set; until then the release just
  gets the desktop apps.

The tag becomes the version number (1.2.3), so phones can tell which one is newer.

### Android: a signing key (free, once)

Android only updates an app with a new version signed by the same key, so Peiskos needs its own key
kept safe for good. Lose it and everyone has to uninstall and reinstall.

1. Make the key. `keytool` comes with Java (for example [Temurin](https://adoptium.net)). In PowerShell:

   ```powershell
   keytool -genkeypair -v -keystore peiskos.keystore -alias peiskos -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Peiskos"
   ```

   Pick a strong password when it asks, and keep `peiskos.keystore` and the password somewhere safe
   (a password manager), outside the repo.

2. Turn the key into text for GitHub:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\peiskos.keystore")) | Set-Clipboard
   ```

3. On GitHub: the repo's **Settings › Secrets and variables › Actions › New repository secret**:
   - `ANDROID_KEYSTORE`: paste (the text from step 2)
   - `ANDROID_KEYSTORE_PASSWORD`: the password
   - `ANDROID_KEY_ALIAS`: `peiskos`

The next release then has `Peiskos-x.y.z.apk` attached. To install it, friends open it on their
phone and allow their browser to install apps when Android asks. Updates install the same way, over
the old version, keeping them logged in.

It also has `Peiskos-x.y.z.aab`, the same app packed the way the Play Store wants it. To put a
version on Play, download that file from the release and upload it in Play Console (*Test and
release*, pick the track, *Create new release*). Both files are signed with the same key, so the
Play version and the download are the same app to Android.

### Android: alerts while the app is closed (Firebase, free)

Android apps get alerts through Google's Firebase. Peiskos only uses it to deliver the alert; the
message text goes from your server straight to Google and on to the phone.

1. At [console.firebase.google.com](https://console.firebase.google.com): **Create a project**
   (call it Peiskos; Google Analytics can be off).
2. **Add app › Android**, package name `app.peiskos`, then **Register app** and download
   `google-services.json`. Skip the remaining steps (the app already has them).
3. On GitHub, add a repository secret `GOOGLE_SERVICES_JSON` and paste the whole file (open it in Notepad).
4. Back in Firebase: the gear › **Project settings › Service accounts › Generate new private key**.
   That downloads a second `.json` file, which goes on the server as `FCM_SERVICE_ACCOUNT` (see
   *Phone alerts* in the main README). Keep it secret: it can send alerts to anyone's Peiskos app.

The next release's Android app then asks for alerts the first time it opens.

### iPhone: TestFlight (needs Apple's $99 a year developer account)

Apple only lets apps onto iPhones through its developer program. TestFlight hands the app to up to
100 people you invite by email, without the App Store's review (each build stays for 90 days, and
each new release sends a new build).

1. Join the [Apple Developer Program](https://developer.apple.com/programs/enroll/) as an individual.
2. In [App Store Connect](https://appstoreconnect.apple.com): **Apps › +  › New App**, platform iOS,
   name *Peiskos*, bundle ID `app.peiskos` (register it under *Certificates, Identifiers & Profiles ›
   Identifiers* first if it isn't in the list), SKU `peiskos`.
3. **Users and Access › Integrations › App Store Connect API › Generate API Key**, with *Admin*
   access (so it can make signing certificates). Download the `.p8` file (only possible once) and
   note the *Key ID* and the *Issuer ID* above the list.
4. Add these repository secrets on GitHub:
   - `APP_STORE_CONNECT_KEY`: the whole contents of the `.p8` file (open it in Notepad)
   - `APP_STORE_CONNECT_KEY_ID`: the Key ID
   - `APP_STORE_CONNECT_ISSUER_ID`: the Issuer ID
   - `APPLE_TEAM_ID`: your Team ID, from [Membership details](https://developer.apple.com/account#MembershipDetailsCard)
5. Run *Start release*. The build appears in App Store Connect under **TestFlight** after Apple has
   processed it. Add friends under *External Testing* (the first build there gets a short review by
   Apple) or *Internal Testing*, and they get an email to install the TestFlight app and then Peiskos.

The app says it uses only standard encryption (HTTPS, and voice encrypted with the browser's own
crypto), so App Store Connect doesn't ask about export rules for each build.

## Building on your own computer

```sh
cd mobile
npm install
npm run android   # copies the client in and opens Android Studio; press Run
npm run ios       # the same for Xcode (on a Mac)
```

`npm run sync` copies `client/` into the app after you change it. The `android/` and `ios/` folders
are ordinary Android Studio and Xcode projects; the native pieces are in
`android/app/src/main/java/app/peiskos/` (the call notification).
