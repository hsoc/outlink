# Background connectivity

Settings includes **Keep connectivity active while in background**, disabled by
default. It requires an updated Android native build and at least one joined
Nearby mesh or Location channel.
The Bluetooth broadcast selector is now **Public Mesh**. Internet location
channels show their selected `#area` button.

## Android behavior

Enabling the setting explicitly requests notification permission on Android 13+.
After either transport is joined while the app is open, the native adapter starts
one non-exported foreground service. Android 14+ uses `connectedDevice` for Nearby
and `remoteMessaging` for Location channels, combining them when both are joined.
Location-only startup requires no Bluetooth permission. Bluetooth runtime permissions
come from joining Nearby. The service immediately posts a low-importance ongoing
notification with a neutral connectivity status, an Open action (tap), and Stop.
A blocked notification channel or denied permission prevents activation.

The service retains the existing React runtime; it never bootstraps identities,
rejoins after process death, or starts from boot. An active Headless JS task keeps
React Native timers available during Activity pause. A partial CPU wake lock is
held for the opted-in joined messaging sessions and released on shutdown;
the screen is not kept on. This increases battery consumption, including while the app is visible.
The service runs while at least one transport is joined so it is established
before backgrounding;
it is not started opportunistically from a background lifecycle callback.

Once native startup is confirmed, backgrounding preserves joined mesh and Location
sessions, including their already open relay/private-mailbox connections without reconnecting or clearing ciphers.
Normal queue, receipt, courier, rotation and relay retry bounds remain unchanged.
Relay-directory refresh and location acquisition remain foreground-only. The
setting does not enable internet messaging, gateways, bridges, or location access.

Turning the setting off, leaving the last joined transport, tapping notification
Stop, wiping the identity, or disposing the root stops the service. Turning it off while
backgrounded pauses the connections and retains normal foreground-resume intent.
An identity wipe invalidates that intent before erasure and disables the setting.
Notification Stop disables the saved option in the live runtime, including
Location-only sessions.
Leaving Nearby keeps the service alive when Location is still joined. Service
updates reuse the notification, Headless JS task and wake lock. App-requested
service shutdown does not disable the saved preference during channel changes.
Swiping away or force-stopping the app stops the service; no automatic restart is requested.
The preference may remain enabled after process death, but another explicit Join
is still required on a cold launch.

The lifecycle checks native service state before allowing sessions to survive a
background transition. Startup/status failure disables the option, reports an
error and uses ordinary pause/resume. Location-only sessions retain public-channel
and enabled private-message connections independently of Nearby. Leaving all sessions releases the service. Older Android
versions use the foreground-service types available on that OS.

Android can still kill the process, stop Bluetooth, throttle scans, or restrict
networking under Doze/vendor battery policies. This feature improves continuity;
it cannot guarantee delivery, uninterrupted radios, or wake-ups after a kill.

## Message alerts

The ongoing service notification describes connectivity; it is separate from
message alerts. **Notify for all Nearby messages in background** is an additional
opt-in setting beneath this switch, followed by Appearance. With the app in the
background and the native service running, it alerts for ordinary Public Mesh
messages, Nearby DMs and joined Bluetooth group messages. Otherwise the separate
mention and private-message preferences apply. The focused foreground conversation
is silent and unread dots identify activity elsewhere. See
[notifications](mentions.md) for filtering, bounds and platform limits.

## iOS

The switch is unavailable on iOS, with an explanation. Core Bluetooth background
modes provide limited native wake-ups, not an unrestricted continuously executing
JavaScript application. The current protocol/crypto engine depends on JavaScript;
adding Info.plist modes alone would not deliver reliable background messaging.
iOS retains its existing pause/resume behavior. No audio/location keepalive or
push registration is added.

## Validation and sources

Lifecycle tests cover retained sessions, switch/notification-stop fallback,
startup denial, lost service, Location-only sessions, transitions between
Nearby/Location/both/no sessions, no background service start,
identity-wipe invalidation and disposal. Native service/device behavior needs
native validation; simulated sessions and bundle exports cannot establish it.

The 2026-11-07 extension passed 16 lifecycle/platform-adapter tests, TypeScript
and lint. Local native compilation remains unavailable because this host has no
complete Android SDK/NDK installation. A new native APK is required for Location-only
background messaging; physical screen-lock and service-type behavior remain
unverified.

The 2026-10-19 check passed 165 Jest tests across 31 suites, TypeScript, lint,
mobile config/storage checks, license consistency, and both mobile bundle exports.
An Android Kotlin compilation was attempted in an isolated temporary SDK; Gradle
stopped during project configuration because NDK 27.1.12297006 was missing and its
SDK license was not accepted there. The new native source was not compiled on
this host. Physical-device testing remains omitted at the maintainer's request.
A new native APK build is required to use the switch.

- [Android foreground service launch restrictions](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Messaging and connected-device foreground service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device)
- [React Native 0.86 Headless JS](https://reactnative.dev/docs/0.86/headless-js-android)
- [Apple Core Bluetooth background limits](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)
