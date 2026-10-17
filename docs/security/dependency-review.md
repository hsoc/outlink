# Dependency review — 2026-10-17

The review used the committed npm lockfile, installed callers, and the npm/GitHub
advisory data. Counts describe affected package entries, including parent chains;
they are not counts of independently exploitable app flaws.

`npm audit --omit=dev` changed from **45 (29 high, 16 moderate)** to
**43 (27 high, 16 moderate)** after compatible patches. The full audit, including
dev dependencies, currently reports **68 (52 high, 16 moderate)**. The production
closure includes Expo/Metro/project-generation tools as ordinary dependencies.
This is not a clean audit or a production-security certification.

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
