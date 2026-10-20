# Android and iOS builds

Run the **Build Mobile Apps** workflow from the Actions tab. Android defaults to
on; iOS is optional. There are no desktop build targets or desktop credentials.
Both use the existing Outlink production application ID `io.github.hsoc.outlink`.
Development builds use `.dev`. The public version is `1.0.0` (Git tag `v1.0.0`). Android version code and iOS
build number are 14; keep increasing these counters even when changing the
public version scheme.

## Android

The existing four repository secrets are unchanged:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Keep the same long-lived key to allow installed Outlink APKs to update. The
workflow runs mobile checks, generates the Android project, builds a release
APK, signs and verifies it, and uploads `Outlink-android.apk` in **android-apk**.
A manual branch build without any signing secrets produces a testing APK with
the generated development signature. Partial credentials fail. Tag builds
require signing credentials. Keep independent backups of the keystore/passwords.

No Play Store upload or public GitHub Release is performed automatically. Tag
runs build Android artifacts; use manual dispatch to request an iOS build.

## iOS

Use the macOS 26 runner with Xcode 26.4, a registered application ID, an Apple Distribution certificate,
and matching provisioning profile. Configure:

- `APPLE_TEAM_ID`
- `IOS_CERTIFICATE_BASE64`: exported PKCS12 signing identity, including private key
- `IOS_CERTIFICATE_PASSWORD`
- `IOS_PROVISION_PROFILE_BASE64`: profile for `io.github.hsoc.outlink`

The optional workflow job installs credentials in a temporary keychain, validates
profile team/application binding, archives, exports an IPA, and uploads **ios-ipa**.
Its default export method is `release-testing` (ad-hoc distribution); the profile must include the test devices.
For App Store distribution, adjust `IOS_EXPORT_METHOD` to the Xcode-supported
App Store export method and use the corresponding distribution profile. No App
Store or TestFlight upload is automated. No Apple credentials are supplied by
this repository.

Locally, `npm run android:apk` uses an installed Android SDK/JDK. On macOS,
`APPLE_TEAM_ID=YOURTEAMID npm run ios:prebuild` creates the workspace; open it in
Xcode for device development or configure the signing script for export.

Before release, test two physical devices across both operating systems,
Bluetooth permissions and reconnection, private fingerprints and receipts,
public channel interoperation with another Bitchat client, location denial,
background/foreground transitions, retained public/private history after force-close,
independent conversation drafts, paged history, explicit local-history deletion,
and installation over an existing Outlink
build. Bundle export and protocol unit tests do not establish radio-level or
signed binary interoperability.

The runner/Xcode pairing follows the [runner image inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md) and [Expo SDK requirements](https://docs.expo.dev/versions/v57.0.0/).
