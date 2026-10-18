# Unused-code review — 2026-10-18

This review covers tracked application modules, mobile entry points, dependency
callers, build configuration, assets, and the retained Android/iOS BLE adapter.
It is a focused cleanup, not proof that every exported helper or design token
is necessary in every execution path.

## Removed

- Desktop typography, density, window/pane geometry, scrollbar occlusion, and
  constant-false desktop platform switches. Existing mobile metrics remain.
- Unreferenced emoji/media/shadow theme helpers from retired UI features.
- Web-only text language attributes and web press-delay compatibility branches.
  Native pointer hover remains useful for tablets, trackpads, and styluses.
- Unused custom-runtime adapter registration and obsolete desktop password
  methods whose mobile implementations were no-ops. Device-secured key storage
  retains its existing accessibility policy and asynchronous operations.
- Three unused JavaScript BLE profile/role methods and the session-stop switch
  back to the retired Nearby protocol. Active sessions still explicitly select
  Bitchat before advertising; stop still tears down native transport activity.
- The unused `expo-status-bar` dependency and its lockfile/catalog entry. No
  retained dependency version changed. The mobile license inventory now has
  733 entries; original third-party source notices remain preserved.
- The obsolete Electron exception in production-license inventory tooling.
- 36 unreferenced website/demo/template/tray/icon-source assets (3,647,799 bytes).
  The four configured mobile app/splash/adaptive-icon images remain. This is a
  source checkout reduction, not a measured APK or IPA reduction.

## Retained deliberately

The shared native Bluetooth implementations still contain the retired Nearby
UUID/profile/framing mode alongside Bitchat. The current JavaScript port only
selects Bitchat and no longer selects Nearby even on shutdown. Removing those
native branches requires Android/iOS compilation and transport validation;
JavaScript exports and simulated radios cannot validate that removal. No native
source was changed in this cleanup.

Protocol compatibility parsers, secure history/key migrations, old-key delivery
windows, upstream fixtures, and fault tests remain active requirements. Generated
license assets are loaded dynamically; original license snapshots and historical
release notes are retained for attribution and provenance. Expo config plugins,
router dependencies and keyboard/reanimation peers can be required without a
literal application import; they were not removed based on text search alone.
`expo-system-ui` implements the configured native appearance behavior.

The tracked production TypeScript import graph reaches all application modules
from native entry points and routes, with the license asset map reached through
its dynamic import. TypeScript reports no unused locals or parameters. This does
not establish that all exported API members are used, nor replace native tests.

## Verification

- 153 Jest tests across 29 suites.
- Strict TypeScript check including unused locals/parameters; lint.
- Mobile configuration/storage checks and license tooling tests/consistency check.
- Android and iOS JavaScript/Hermes exports.

Physical-device testing remains omitted at the maintainer's request. Native
release compilation was not performed. The dated dependency advisory review is
historical evidence for its recorded lock hash; removing one unused package is
not a refreshed advisory audit or a claim that the remaining findings are fixed.
