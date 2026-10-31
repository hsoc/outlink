# Android and iOS builds

Run the **Build Mobile Apps** workflow from the Actions tab. Android defaults to
on; iOS is optional. There are no desktop build targets or desktop credentials.
Both use the existing Outlink production application ID `io.github.hsoc.outlink`.
Development builds use `.dev`. The public app version is `1.1.4`; changing it does not require a Git tag. Android version code and iOS
build number are 19; keep increasing these counters even when changing the
public version scheme.

## Android

The existing four repository secrets are unchanged:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Keep the same long-lived key to allow installed Outlink APKs to update. The
workflow runs mobile checks, generates the Android project, builds a release
APK and (when signing credentials are present) an Android App Bundle (AAB), signs
and verifies both, and uploads `Outlink-android.apk` in **android-apk** and
`Outlink-android.aab` in **android-aab**. Upload the AAB to Google Play Console;
the APK is for direct installation and testing. Google Play App Signing should
be configured before production release. When using Google-generated app signing
keys, the upload key and the Play-distributed signing key differ.
A manual branch build without any signing secrets produces a testing APK with
the generated development signature and does **not** generate a Play Store AAB. Partial credentials fail. Tag builds
require signing credentials. Keep independent backups of the keystore/passwords.

Tag builds publish a GitHub Release only after checks and the signed Android build
succeed. Tags containing a hyphen are prereleases. No Play Store upload is performed.
An AAB is available only for signed builds; keep signing credentials backed up.
Before each release, increment `expo.android.versionCode` in `app.json`. Tag
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


Private Bluetooth groups require the updated application bundle. Automated
validation includes independent group crypto checks and simulated multi-hop group
invitation/message/backfill tests. The maintainer reports physical-device testing and authorizes stable distribution
starting with 1.1.1. A detailed cross-platform test matrix has not been recorded;
automated checks alone must not be presented as physical validation. See [private groups](protocols/private-groups.md).

## Release notes and versioning

Update app.json, package.json and the root package-lock.json version together;
increment both native build counters. Write concise user-facing notes in
`docs/releases/<app-version>.md` and the Android changelog matching the version code.
Do not claim physical interoperability or real-fund testing from automated checks.
Push the version commit to master, then a matching `v<app-version>` or
`v<app-version>-beta.<number>` tag. The release job validates tag/version agreement,
uses only that run's APK/AAB artifacts, and refuses to overwrite an existing release.
It adds SHA-256 checksums and the source/build-run links to the published notes.
iOS remains an optional manually requested build; tag releases do not attach an IPA.
The historical first-beta workflow is retained only for its original release.

## Android native-build stalls

The 1.1.1 run stopped producing output during native CMake configuration for
react-native-screens and timed out after 90 minutes. Both Gradle worker slots were
running native configuration; the logs do not establish an exact deadlock cause.
The build runner now disables project parallelism and uses one Gradle worker,
while limiting CMake subprocess parallelism to two. CI preinstalls CMake 3.22.1 and
both NDK versions used by the locked modules (27.1.12297006 and 27.0.12077973),
avoiding SDK installation during concurrent native configuration. All existing
Android ABIs, source-built modules and signing verification remain enabled.

The native Gradle runner uses plain detailed logs and a 15-minute no-output
watchdog. Progress heartbeats do not reset that timer. A stall captures process
names and selected Gradle/Prefab Java thread stacks, terminates the process group,
and fails visibly. Failure/cancellation uploads `android-build-diagnostics` for
seven days, including Gradle and relevant CMake logs. Signing secrets are removed
from the native process environment; environment dumps and signing files are not
collected. The normal 90-minute outer job limit is unchanged. A diagnostic pass
can distinguish a native configuration stall from a slow but progressing build.

The failed 1.1.1 tag is retained as provenance; the corrected stable release is
1.1.2/build 17. Existing published release assets are never replaced.
