# Security

Report vulnerabilities through the repository's private reporting channel when
available: https://github.com/hsoc/outlink/security/advisories/new.

Bluetooth private chat uses the retained Bitchat Noise XX implementation and
stable device keys in platform secure storage. Public mesh and geohash messages
are public. Fingerprint comparison remains necessary for peer verification.
There is no assertion of an independent security audit or guaranteed anonymity.

Public-channel intake bounds input sizes/rates, validates channel/timestamp/expiry,
recomputes canonical event IDs, verifies signatures, and deduplicates across
relays. Session keys are cleared and pending operations stopped on leave.
Historical signing keys, relays, nicknames, and radio metadata still have privacy
implications. See docs/PRIVACY.md and docs/protocols/geohash.md.

No remote-event content is executed, rendered as HTML, or used as a relay URL.
No internet push, Tor, Nostr private-message fallback, or background delivery is
implemented in the mobile-only app. Do not send sensitive data in public channels.

## Dependency advisory status

On 2026-10-17, `npm audit --omit=dev` reported 45 advisory-affected package
entries (29 high, 16 moderate). Expo's dependency closure includes build tooling,
so this is not a count of confirmed exploitable mobile runtime flaws. Findings
include glob/brace parsing, URI decoding, build certificate tooling, UUID
buffer handling, and formatting/source-map utilities. Some suggested fixes
require incompatible Expo/React Native version changes. No blanket SDK upgrade
or `npm audit fix --force` was applied as part of this mobile redesign. Review
and update the supported SDK/tooling versions before a production release.
