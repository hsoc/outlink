# Android release optimization

Release builds enable R8 code shrinking, full-mode optimization, class/member
renaming and optimized resource shrinking. Debug builds retain the Expo defaults.
`plugins/with-android-optimization.js` writes the existing Expo template's release
properties and selects `proguard-android-optimize.txt` on every clean prebuild.
It fails if the template no longer exposes the expected default rules file.
No runtime dependency, packer, custom DEX rewriting or JavaScript obfuscator is added.

The Android toolchain is prepared for AGP 9.0.1 and Kotlin 2.2.10 through versioned
React Native/Expo build-plugin patches. Both the app plugin and the React Native
source build use matching versions. Optimized resource shrinking is enabled. Framework/JNI/reflection consumer rules
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

## Measured optimized build — 2026-11-02

[Build 41423211468](https://github.com/hsoc/outlink/actions/runs/41423211468), source
`26a0580`, produced signed optimized APK/AAB artifacts and passed the API 36 x86_64
release startup smoke check. The emulator rendered Nearby/Location controls and
remained running without an app crash. All release checks passed, including the
328 app tests and the three DEX/mapping-report tests.

| Metric | Published v1.1.7 | Optimized build |
| --- | ---: | ---: |
| Universal APK bytes | 141,211,247 | 127,275,263 |
| Uncompressed DEX bytes | 52,889,412 | 11,990,972 |
| Compressed DEX bytes | 18,876,939 | 5,333,259 |
| DEX files | 5 | 2 |
| Final DEX class definitions | 42,446 | 12,699 |
| Uncompressed native-library bytes | 109,368,396 | 109,368,396 |

Uncompressed DEX is 77.3% smaller; the universal APK is 9.9% smaller. The mapping
contains 12,796 original class entries with changed names (this can include
classes merged by the optimizer). This verifies native-code obfuscation; it is
not a runtime speed measurement. The native libraries and four-ABI support remain.
Expo's Metro asset exporter generates `res/raw/keep.xml` for referenced images and
license files, so their resource preservation reuses the existing asset pipeline.

The **android-apk** artifact is the optimized test installer. **android-r8-reports**
contains its mapping/configuration and measured JSON; **android-release-smoke**
contains the startup screenshot, UI dump and logs. The previously published
v1.1.7 downloads were not replaced, and no new version/tag was published by this
optimization change. Physical Bluetooth/background/private-message validation
on the optimized APK remains outstanding.


## Android 15 system-bar warnings

The v1.1.12 mapping from build 42403841893 resolves the reported shortened names:

| Reported location | Mapped origin |
| --- | --- |
| `Tb.k.j` | React Native Screens `FormSheetDialog`, with Material `BottomSheetDialog.onCreate` inlined |
| `d8.b.runGuarded` | React Native `StatusBarModule.setColor` runnable |
| `H5.a.B` / `H5.a.s` | R8-generated API outline methods taking `WindowManager.LayoutParams`. The synthetic holder's Glide-derived name does not identify the original caller |

The unshortened entries belong to React Native status-bar/window utilities and
Expo Image Picker. The checked-in React Native 0.86.3 implementation still contains
legacy system-bar color APIs and older cutout modes for compatibility. The image
picker already uses `WindowCompat.enableEdgeToEdge` with system-bar/display-cutout
insets; compatibility code in its native dependency chain can remain visible to
Play's analysis even when Outlink does not request cropping.

Outlink's `AppScreen` sets only status-bar icon style. Its deprecated
`backgroundColor` and `translucent` props were removed. The Expo 57 edge-to-edge
window and existing safe-area views own the background and content insets.
The follow-up native migration uses versioned `patch-package` patches:

- React Native 0.86.3 reads and writes legacy status-bar colors only below API 35.
  Its edge-to-edge setup skips legacy bar colors on Android 15+, and hiding/showing
  the status bar uses inset controllers instead of old cutout modes there.
- Keyboard Controller 1.21.9 skips its legacy color setter on Android 15+.
- Expo Image Picker 57.0.21 sets decor fitting, `ALWAYS` cutouts and contrast
  directly on Android 15+, retaining its older compatibility path below API 35.
- React Native Screens 4.26.2 uses Material 1.14.0, whose bottom-sheet utilities
  guard legacy bar APIs below API 35. The version is pinned in its Gradle patch.

Expo BuildProperties enables `android.buildReactNativeFromSource` so the React
Native patch is compiled instead of using the published Android AAR. The setting
also builds Hermes from source and substantially increases Android build time.
The Android job allows 180 minutes, preserving the no-output watchdog.
`npm ci` reapplies the exact-version patches and
fails if they no longer apply. Dependency upgrades must review these patches.

Legacy APIs remain in branches used on older supported Android versions, so a
static Play scan can still report references. A newly built APK/AAB and Play scan
are required before claiming the warning list is clear. Obfuscated names are
specific to each build, so always use the matching mapping artifact.

Local validation covers 352 Jest tests, TypeScript, lint, mobile configuration,
license consistency, fresh-archive patch application, clean Android prebuild
and Android/iOS bundle exports.
Native compilation and Android 15/16 device validation remain outstanding.

Validate status/navigation icons, portrait and landscape cutouts, keyboard
opening, modal sheets and the image picker on Android 15/16 and an older supported
Android version. Static checks and bundle export do not establish this visual QA.

Sources: [Material 1.14.0 system-bar compatibility helpers](https://github.com/material-components/material-components-android/blob/1.14.0/lib/java/com/google/android/material/internal/EdgeToEdgeUtils.java),
[Expo 57 source-build configuration](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/),
[React Native 0.86 StatusBar deprecations](https://reactnative.dev/docs/0.86/statusbar),
[Android 15 edge-to-edge changes](https://developer.android.com/about/versions/15/behavior-changes-15#edge-to-edge).


## AGP 9 migration

AGP 9.0.1 is pinned in both React Native Gradle version catalogs. The React Native
Gradle plugin and Expo Gradle-plugin compilers align on Kotlin 2.2.10. Expo
Gradle plugins also compile against AGP 9.0.1. Library target SDK configuration
uses `lint.targetSdk` and `testOptions.targetSdk` instead of the removed
`LibraryDefaultConfig.targetSdk` setter. Worklets and Reanimated register the
React plugin in their initial plugins block so codegen callbacks precede AGP 9
DSL finalization. The existing
Gradle 9.3.1 wrapper and CI JDK 17 meet AGP 9 requirements. NDK/ABI settings retain
the explicitly selected versions.

Expo and native dependencies still use `BaseExtension`, legacy variant APIs and
`kotlin-android`. Google-supported transitional properties `android.newDsl=false`
and `android.builtInKotlin=false` are applied in generated app properties and the
included React Native source build. These opt-outs are temporary AGP 9 migration
settings and require removal before upgrading to AGP 10. They do not disable R8.

Full-mode code optimization, optimized resource shrinking, mapping/report
validation and the signed-release emulator startup gate remain enabled. Changes
to optimizer behavior need a newly built APK/AAB,
JNI/reflection/startup validation and measured memory/startup comparisons. The
existing APK size measurements above describe AGP 8 builds and do not establish
AGP 9 memory or performance improvements.

Sources: [AGP 9.0.1 requirements and changes](https://developer.android.com/build/releases/agp-9-0-0-release-notes),
[AGP 9 Kotlin migration and temporary opt-outs](https://developer.android.com/build/migrate-to-built-in-kotlin#opt-out).

Local migration validation passed clean Android prebuild, all six mobile
configuration checks, the three R8 report tests, TypeScript, lint and patch
application against integrity-verified original archives. Gradle with JDK 21
compiled the React Native and Expo build plugins, selected Kotlin 2.2.10/KSP
2.2.10-2.0.2 and reached native project configuration. It then stopped because
NDK 27.1.12297006 is absent and its SDK license is not accepted on this host.
Native compilation, R8 output and device performance are still unverified for
this migration.

React Native registers its root-wide Android library configuration once per build.
This prevents repeated `finalizeDsl` calls on already configured libraries under AGP 9.

Expo source-set paths resolve to directories before registration, as required by
AGP 9; the existing `preBuild` dependency still generates the package list first.

React Native/Hermes source scripts explicitly suppress legacy Gradle DSL
deprecations during this transitional opt-out. React Native source exclusions use
Gradle’s `PatternFilterable` interface, preserving the existing processor filters
after AGP 9 narrowed the source-directory interface.

Hermes extraction accepts the `meta-hermes-` archive prefix after the upstream
repository rename, as well as the original `facebook-hermes-` prefix. The pinned
Hermes version remains unchanged.
