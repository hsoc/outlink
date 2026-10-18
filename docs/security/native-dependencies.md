# Native dependency review — 2026-10-18

This is a source-declaration review and limited advisory lookup. It is **not** a
resolved release SBOM, a full native vulnerability scan, or evidence of a native
build. Sources are the npm-locked React Native 0.86.3, Expo Camera 57.0.6 and
Expo SQLite 57.0.3 package contents. npm does not audit their Maven, CocoaPods,
or bundled C/C++ libraries.

## Android declarations

The React Native Gradle catalog declares OkHttp 4.9.2 and Okio 2.9.0. Expo Camera
declares CameraX 1.6.0, ExifInterface 1.4.2, ML Kit barcode scanning 17.3.0 and
Play Services code scanner 16.1.0. These six exact versions were queried against
OSV; requests and results are retained in the [audit snapshot](dependency-audit-2026-10-18.json).
Five returned no matching advisory, which is not proof of safety or coverage of
their transitives. The Okio query returned
[GHSA-w33c-445m-f8w7 / CVE-2023-3635](https://github.com/advisories/GHSA-w33c-445m-f8w7).

The Okio issue concerns malformed gzip input causing denial of service. The
React Native Android networking source imports `GzipSource` and supports gzip
response decoding; this is not dismissed as build-only. The advisory fixes are
3.4.0 and 1.17.6, outside the declared 2.x line. A forced cross-major override
was not applied without a resolved graph and native checks. The final selected
version might differ due to Gradle conflict resolution; installed source
catalogs cannot establish the version in a release APK.

A Gradle 9.3.1 release-runtime dependency report was attempted with JDK 21 and an
isolated temporary cache. Build plugins resolved, but application configuration
failed with **SDK location not found** before the release graph was available.
No dependency report, APK or vulnerability-free Android graph is claimed. Before
release, obtain `:app:dependencies --configuration releaseRuntimeClasspath` and
`dependencyInsight --dependency okio` on the configured Android build host, then
recheck the selected complete graph and validate any upgrade there.

## iOS and bundled native code

No `Podfile.lock` is available and this Linux host has no CocoaPods/Xcode runtime.
The Expo Camera podspec depends on `ZXingObjC/PDF417` and `ZXingObjC/OneD` without
a resolved version here. React Native source podspecs declare Boost 1.84.0,
Folly 2024.11.18.00, glog 0.3.5, fmt 12.1.0, fast_float 8.0.0 and
DoubleConversion 1.1.6. Android's native catalog uses Boost 1.83.0 instead.
These declarations are an inventory, not an advisory-clean iOS dependency graph;
precompiled modules and platform resolution can select a different build closure.
Retain and review the generated `Podfile.lock` on the macOS build host before release.

Expo SQLite's bundled header declares SQLite **3.50.3**. The
[SQLite security table](https://www.sqlite.org/cves.html) lists later fixes,
including CVE-2026-11822/CVE-2026-11824 in 3.53.2, involving arbitrary SQL,
FTS5 and disabled defensive mode. Existing storage uses fixed application SQL
with bound values, no public SQL interface, and no untrusted database import;
no chat-input path to those preconditions was found. This is a reachability
assessment, not a declaration that all older SQLite bugs are harmless.

Outlink does not use full-text SQL tables. The supported Expo SQLite plugin is
now explicitly configured with **`enableFTS: false`** for both platforms. Generated
`android/gradle.properties` and `ios/Podfile.properties.json` both contain the
corresponding false setting, and storage/configuration regressions check the
application boundary. See [Expo's SQLite configuration](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).
This is a targeted reduction of unused attack surface; SQLite remains 3.50.3.
A supported Expo SQLite update and verification of the compiled native flags
remain necessary for a complete native review. No native library source is
vendored or replaced in this change.

The custom proximity module uses Android platform Bluetooth APIs and iOS
CoreBluetooth, with no added third-party Bluetooth SDK. OS security updates,
physical radio behavior and native key storage still require platform validation;
physical-device testing remains omitted at the maintainer's request.
