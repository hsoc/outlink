# Security

Report vulnerabilities through the repository's private reporting channel when
available: https://github.com/hsoc/outlink/security/advisories/new.

Bluetooth 1:1 private chat uses the retained Bitchat Noise XX implementation and
stable device keys in platform secure storage. Public mesh and geohash messages
are public. Fingerprint comparison remains necessary for peer verification.
There is no assertion of an independent security audit or guaranteed anonymity.

Public-channel intake bounds input sizes/rates, validates channel/timestamp/expiry,
recomputes canonical event IDs, verifies signatures, and deduplicates across
relays. Session keys are cleared and pending operations stopped on leave.
Historical signing keys, relays, nicknames, and radio metadata still have privacy
implications. See docs/PRIVACY.md and docs/protocols/geohash.md.

No remote-event content is executed, rendered as HTML, or used as a relay URL.
Remote push and Tor are not implemented. Optional Bitchat internet private
messages and Android background connectivity have documented delivery limits;
local mention alerts do not add remote wake-up. Do not send sensitive data in public channels.

## Local storage

Messages, drafts, nickname, and selected conversations/channels are encrypted at
rest with XChaCha20-Poly1305 and a separate device-secured key. Keyed indexes hide
room names and message IDs. Missing keys or authentication failures preserve data
and fail closed. This is record encryption, not an app lock or full-file encryption.
See [local storage](docs/security/local-storage.md) for migration and backup limits.

## Dependency advisory status

On 2026-10-17 compatible brace-expansion/source-map-js patches reduced the npm
production-closure audit from 45 affected entries to 43 (27 high, 16 moderate).
Five root advisory groups remain; affected Expo build dependencies are included
in these counts. External native links are restricted before navigation query
parsing to reduce exposure to the remaining decode-uri-component finding.
No blanket SDK upgrade, forced overrides, or audit suppression was applied.
See the [dependency assessment](docs/security/dependency-review.md) for exact
versions, paths, remaining risks, and validation.

## Private Bluetooth groups

Group state requires both authenticated Noise creator identity and a signed,
pinned creator roster; encrypted group messages require a roster-member signature.
Removal rotates keys without giving the removed peer the replacement key. Keys
and membership records are authenticated/encrypted under the local storage key.
The explicit [group security profile](docs/protocols/private-groups.md) describes
metadata exposure, replay/epoch checks, consent, departure, retention, resource
bounds and the intentional 255-versus-16-member compatibility difference. This
creator-managed symmetric-key design is not MLS and is not independently audited.
