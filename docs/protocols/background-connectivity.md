# Background connectivity

Settings includes **Keep connectivity active while in background**, disabled by
default. It requires an updated Android native build and a joined Nearby mesh.
The Bluetooth broadcast selector is now **Public Mesh**. Internet location
channels use the separate **Public channel** label.

## Android behavior

Enabling the setting explicitly requests notification permission on Android 13+.
After a mesh is joined while the app is open, the native adapter starts a
non-exported `connectedDevice` foreground service. Bluetooth runtime permissions
come from joining the mesh. The service immediately posts a low-importance ongoing
notification with a neutral connectivity status, an Open action (tap), and Stop.
A blocked notification channel or denied permission prevents activation.

The service retains the existing React runtime; it never bootstraps identities,
rejoins after process death, or starts from boot. An active Headless JS task keeps
React Native timers available during Activity pause. A partial CPU wake lock is
held for the opted-in joined session and released on shutdown; the screen is not
kept on. This increases battery consumption, including while the app is visible.
The service runs while a mesh is joined so it is established before backgrounding;
it is not started opportunistically from a background lifecycle callback.

Once native startup is confirmed, backgrounding preserves that mesh and already
open relay/private-mailbox sessions without reconnecting or clearing ciphers.
Normal queue, receipt, courier, rotation and relay retry bounds remain unchanged.
Relay-directory refresh and location acquisition remain foreground-only. The
setting does not enable internet messaging, gateways, bridges, or location access.

Turning the setting off, leaving the mesh, tapping notification Stop, wiping the
identity, or disposing the root stops the service. Turning it off while
backgrounded pauses the connections and retains normal foreground-resume intent.
An identity wipe invalidates that intent before erasure and disables the setting.
Notification Stop disables the saved option in the live runtime. Swiping away or
force-stopping the app stops the service; no automatic restart is requested.
The preference may remain enabled after process death, but another explicit Join
is still required on a cold launch.

The lifecycle checks native service state before allowing sessions to survive a
background transition. Startup/status failure disables the option, reports an
error and uses ordinary pause/resume. Internet-only sessions have no active mesh
and still pause: this service is declared for connected-device work, not as a
way to run an unrelated permanent internet daemon.

Android can still kill the process, stop Bluetooth, throttle scans, or restrict
networking under Doze/vendor battery policies. This feature improves continuity;
it cannot guarantee delivery, uninterrupted radios, or wake-ups after a kill.

## iOS

The switch is unavailable on iOS, with an explanation. Core Bluetooth background
modes provide limited native wake-ups, not an unrestricted continuously executing
JavaScript application. The current protocol/crypto engine depends on JavaScript;
adding Info.plist modes alone would not deliver reliable background messaging.
iOS retains its existing pause/resume behavior. No audio/location keepalive or
push registration is added.

## Validation and sources

Lifecycle tests cover retained sessions, switch/notification-stop fallback,
startup denial, lost service, internet-only sessions, no background service start,
identity-wipe invalidation and disposal. Native service/device behavior needs
native validation; simulated sessions and bundle exports cannot establish it.

The 2026-10-19 check passed 165 Jest tests across 31 suites, TypeScript, lint,
mobile config/storage checks, license consistency, and both mobile bundle exports.
An Android Kotlin compilation was attempted in an isolated temporary SDK; Gradle
stopped during project configuration because NDK 27.1.12297006 was missing and its
SDK license was not accepted there. The new native source was not compiled on
this host. Physical-device testing remains omitted at the maintainer's request.
A new native APK build is required to use the switch.

- [Android foreground service launch restrictions](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Connected-device foreground service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device)
- [React Native 0.86 Headless JS](https://reactnative.dev/docs/0.86/headless-js-android)
- [Apple Core Bluetooth background limits](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)
