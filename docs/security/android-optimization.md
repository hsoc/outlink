# Android release optimization

Release builds enable R8 code shrinking, full-mode optimization, class/member
renaming and optimized resource shrinking. Debug builds retain the Expo defaults.
`plugins/with-android-optimization.js` writes the existing Expo template's release
properties and selects `proguard-android-optimize.txt` on every clean prebuild.
It fails if the template no longer exposes the expected default rules file.
No runtime dependency, packer, custom DEX rewriting or JavaScript obfuscator is added.

The current React Native Gradle plugin pins AGP 8.12.0. Optimized resource shrinking
is explicitly enabled for that version. Framework/JNI/reflection consumer rules
from React Native, Expo and native dependencies remain in force, as do the Expo
app template's Reanimated/TurboModule rules. There is no blanket keep for the
Outlink package, no blanket warning suppression, and no logging-removal rule.
Expo's Module consumer rules retain module constructors/definitions while permitting
supported optimizations. Android manifest components remain rooted by the build tools.

## Verification and reporting

The build inspects the signed APK's actual DEX headers and produces
`release/android-r8-report.json`: DEX counts, byte sizes, class definitions,
renamed classes and total native-library bytes. It requires a mapping file with
actual renamed classes and rejects merged rules containing global `-dontshrink`,
`-dontoptimize` or `-dontobfuscate`. These are size/build checks, not startup or
throughput benchmarks. Whole-APK size also includes native libraries for four ABIs,
Hermes bytecode and assets; DEX changes cannot shrink all of those components.

After building, a disposable API 36 x86_64 emulator installs the actual release
APK, waits for Nearby/Location controls, checks initialization/process survival
and captures a screenshot/logs. Publication waits for this smoke check. This
checks optimized startup; it does not validate physical Bluetooth, background
radio continuity, QR scanning or real-device DM interoperability. Those flows
need testing on the optimized APK before relying on it on devices.

Mappings and R8 reports are uploaded as **android-r8-reports**, retained for 90 days.
Archive each production build's mapping privately for long-term crash retracing;
rebuilding the same version can produce a different map. They are not added as
standalone public GitHub release downloads. Android's standard AAB metadata can
include the map for Play crash deobfuscation. Do not treat mappings as secrets or
this setup as protection against a determined reverse engineer.

R8 applies to Java/Kotlin DEX code. Release JavaScript is already minified/compiled
with Hermes; R8 does not hide that logic, encrypt stored data, change network
protocols, or strengthen cryptography. MIT source availability remains unchanged.

Sources: [Android R8 configuration](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization),
[optimization troubleshooting and mapping retention](https://developer.android.com/topic/performance/app-optimization/troubleshoot-the-optimization),
and the checked-in Expo 57 Android template/React Native and Expo consumer rules.

## Baseline

The published v1.1.7 universal APK is 141,211,247 bytes. Its five DEX files total
52,889,412 uncompressed bytes (18,876,939 compressed bytes) and 42,446 class
definitions. Native libraries total 109,368,396 uncompressed bytes across all ABIs.
The baseline was read from the published APK, not estimated from source counts.
