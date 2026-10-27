# Dependency review — refreshed 2026-10-18

The review used the committed npm lockfile, installed callers, and fresh npm/GitHub
advisory data on 2026-10-18. The original patch review was on 2026-10-17. Counts describe affected package entries, including parent chains;
they are not counts of independently exploitable app flaws.

`npm audit --omit=dev` changed from **45 (29 high, 16 moderate)** to
**43 (27 high, 16 moderate)** after compatible patches. The fresh audit confirms these same production counts. The full audit, including
dev dependencies, reports **68 (52 high, 16 moderate)**. The production
closure includes Expo/Metro/project-generation tools as ordinary dependencies.
This is not a clean audit or a production-security certification.

Subsequent unused-code cleanup removed only `expo-status-bar` without upgrading
retained dependencies. The recorded advisory JSON and lock hash remain a dated
snapshot; see the [cleanup review](../maintenance/unused-code-review.md).

## Applied patches

| Package | Previous | Updated | Reason |
| --- | --- | --- | --- |
| brace-expansion | 1.1.18 / 5.0.9 | 1.1.21 / 5.0.12 | Compatible fixes for recursion/expansion denial of service across ten locked copies. |
| source-map-js | 1.2.1 | 1.2.2 | Compatible indexed source-map denial-of-service fix. |

Only these eleven resolved package instances changed; Expo, React Native, router,
and the crypto dependencies retain their versions. The existing @libp2p/noise
security patch is retained. Third-party notices were refreshed.

Sources: [brace expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[source-map advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

## Remaining advisory groups

| Package/version | Observed use and assessment | Disposition |
| --- | --- | --- |
| braces 3.0.3 | micromatch, Metro and related file/glob tools; no chat-content glob expansion was found. Deeply nested untrusted build patterns can exhaust the stack. | No published patched version in this audit. Retain supported toolchain; do not treat untrusted patterns/repositories as safe build input. [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). |
| decode-uri-component 0.2.2 | query-string is imported by Expo Router path/state parsing. External link parameters are a runtime input, so this is not dismissed as build-only. | Added a native-intent boundary that returns only known static routes, drops all external query/fragment parameters, and rejects oversized links before tolerant decoding. Existing screens have no external query contract. The vulnerable library remains installed; a supported upstream router/SDK fix is still needed. [Advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr). |
| node-forge 1.4.0 | Expo CLI/code-signing-certificate tooling; RSA certificate signature-verification issue. Not the Bitchat Noise or geohash verification implementation. | No patched release in this audit; keep certificate/signing inputs trusted. No claim that all tooling paths are unaffected. [Advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv). |
| sprintf-js 1.0.3 | argparse through NYC configuration/build-test tooling; uncontrolled format precision can exhaust resources. No public-message formatting caller was found. | No patched release in this audit. No cross-major forced substitution. [Advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). |
| uuid 7.0.3 | xcode project generation uses v4. The advisory concerns caller-supplied output buffers in v3/v5/v6. | Retain the declared xcode dependency; observed v4 use does not establish reachability of the affected buffer API. A supported dependency update remains desirable. [Advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq). |

Suggested automatic fixes included downgrading Expo to 44 or moving router/React
Native to incompatible major versions. Those were intentionally not applied.
No advisory was suppressed or declared fixed solely because an app-level guard
was added. Review native platform dependency advisories separately before release;
this npm assessment does not cover CocoaPods/Gradle or prove absence of other flaws.

Validation includes protocol and storage regressions, type/lint checks, offline
notice consistency, and Android/iOS bundle exports. Physical-device testing was
omitted at the maintainer's request.


Compatibility-stage additions: `expo-camera@57.0.6` and
`qrcode-generator@2.0.4` are locked for explicit QR contact sharing. The camera
plugin disables microphone permission/recording; generated Android/iOS projects
were checked for camera-only permission changes. The QR package omits a LICENSE
file from its npm archive, so its published MIT notice is retained as a reviewed,
integrity-pinned override. Production npm audit remains 43 findings (27 high,
16 moderate), with no reported advisory for the camera, QR encoder,
barcode-detector or zxing-wasm additions. Existing unresolved findings above
remain unresolved. Native compilation and native dependency audits are separate.

## 2026-10-18 refresh

Both npm audit endpoints were queried successfully against the unchanged lockfile.
The five underlying advisory groups and severity totals remain unchanged. None
is suppressed. No compatible patched dependency update was identified; automatic
suggestions still include Expo 44.0.6, router 58.0.23 and React Native 0.88.0,
which are unsuitable replacements for this Expo 57 application. The uuid fix is
in a different major line. Package versions and the lockfile remain unchanged.

The [machine-readable snapshot](dependency-audit-2026-10-18.json) records the
lockfile SHA-256, installed affected versions, advisory links, npm totals, proposed
incompatible fixes, and six native-version OSV queries. The JSON is evidence of
this dated review, not a live health indicator or full native SBOM.

The [native dependency review](native-dependencies.md) identifies a declared Okio
version affected by CVE-2023-3635 and SQLite security-fix gaps outside npm's audit.
Android release dependency resolution could not finish without an Android SDK;
CocoaPods resolution is unavailable on this Linux host. These are open gaps,
not clean scan results. Generated Android and iOS projects both confirm the new
`enableFTS: false` SQLite configuration. This removes unused full-text extensions
from the configured build; it does not upgrade SQLite or alter the npm totals.

Expanded automated interoperability coverage includes lost public fragments with
signed history recovery at small MTUs, a lost Noise replacement response with
working-session preservation, disconnected-relay late acknowledgments, private
retry after a lost acknowledgment with duplicate delivery/read monotonicity, and
unchanged official frozen iOS/Android envelopes through the inbox runtime. A
fixture SHA-256 check protects the published provenance boundary. Physical/native
binary interoperability remains unverified.

Validation for this refresh: 138 tests in 27 Jest suites, TypeScript, clean lint,
mobile configuration/storage checks, 734-notice consistency, Android/iOS native
project generation and both JavaScript/Hermes bundle exports passed. The offline
Expo SDK version check reported dependencies up to date while warning that
offline validation is less reliable; it is not a substitute for the live audit.
Native compilation and full resolved native advisory scans remain outstanding.


## Local mention notification dependency update — 2026-10-20

Added Expo SDK 57 `expo-notifications` 57.0.23 for local alerts; its required
`expo-application` 57.0.3 and `badgin` 1.2.3 dependencies were added, and
`expo-constants` moved from 57.0.18 to the notification SDK's required 57.0.22.
Npm packages declare MIT licenses. The badgin npm archive omits its license file;
a reviewed upstream MIT snapshot and integrity-pinned inventory override supply
it. Firebase Android Cloud Messaging 25.0.1 is a dormant native dependency of the
SDK; its upstream Apache-2.0 license is included in native notices. No upstream
Bitchat application code is copied. Outlink remains MIT licensed.

The production npm audit on this date reports 43 findings (16 moderate, 27 high,
0 critical). None are assigned to the four added/upgraded npm packages. These
are dependency-tree findings, not proof of application exploitability; existing
unresolved findings are not fixed by this feature. No automatic audit fix or
unrelated dependency upgrades were applied. Native transitive advisory scanning
and physical notification behavior remain outside the verified scope. Local
notification API imports and generated native configuration are tested to avoid
remote registration: APNs/remote wake-up are absent and FCM/analytics auto-init
are disabled. No remote credentials or Google services file is added.


## Focused source security re-check — 2026-10-20

A fresh production npm audit still reports 43 findings (27 high, 16 moderate,
0 critical). No dependency versions were changed. See the
[source review and cleanup fixes](security-review-2026-10-20.md) for findings,
validation and remaining limitations.

## Prepared Cashu transfer decoder — 2026-10-28

Pinned `@cashu/cashu-ts` 4.13.0 for standard token decoding only, using its MIT
license option. Its required Noble/Scure dependencies and original license texts
are included in the regenerated mobile notices. No mint/network wallet instance
is constructed. The lockfile resolves additional crypto versions required by the
SDK and updates shared `@scure/base` to 2.4.0.

Fresh full `npm audit` reports **10 affected package entries (4 high, 6 moderate)**
for both the pre-change lockfile and the Cashu lockfile. Neither the Cashu decoder
nor its newly resolved crypto dependencies appear as affected entries. Remaining
entries are Expo/CLI/router/config-plugins, decode-uri-component, node-forge,
query-string, uuid, xcode and zod; they were not changed or suppressed in this
feature. These current counts supersede the older snapshot counts above without
claiming those older advisories were all independently fixed. See the
[current audit snapshot](dependency-audit-2026-10-28.json).
