# Mobile architecture

Outlink ships Android and iOS applications only. There is no desktop runtime,
account bootstrap, wallet, old Nearby session, or push
notification extension in the application dependency graph.

`src/app/` owns four screens: chat, appearance settings, bundled license notices,
and the root layout. They reuse the original shared controls and theme.
`src/services/bitchat/` owns the Bluetooth codec, fragmentation, Noise sessions,
receipts, verification, durable contacts/outbox/gossip, and bounded in-memory room state. It talks directly to the retained
BLE port rather than suspending an unrelated messaging service.

`src/services/geohash/` implements geohash encoding/bounds, per-channel signing
keys, signed public events, and bounded WebSocket relay sessions. Public
location channels and encrypted mesh private conversations are separate data
paths. A user must explicitly join each transport. Relay endpoints are limited
to six secure WebSocket URLs. No location lookup or relay connection occurs on
ordinary launch. Optional private favorite delivery reuses the relay session in
a separate subscription mode; it is disabled by default and never bridges
private content into public channels.

Services use `src/platform/` for secure storage, asynchronous key/value
preferences, foreground location, lifecycle, notices, and BLE. Services do not
import React Native or Expo. The project-owned `modules/expo-proximity` native
module is retained because it supplies Bluetooth central/peripheral roles,
framing, and compression needed by Bitchat.

A new device identity is generated locally and kept in platform secure storage.
Bluetooth Noise/Ed25519 keys remain stable. Location signing keys are derived
separately for each exact channel. A shared nickname or public radio behaviour
can still link activity; derived keys are not an anonymity guarantee.

Both transports stop on background. Pending operations are cancelled or rejected,
connections/timers are released, private session key material is cleared, and
message history is retained. Foreground resumption reconnects sessions that were
active before backgrounding. Cold launch restores history and selections without
opening a transport until Join. History uses an asynchronous SQLite platform port,
indexed by keyed room/message identifiers and insertion sequence, with 200-record pages and a 500-record
visible window. Writes are incremental and serialized with reads and deletion.
Drafts are keyed per public/private mesh conversation or geohash. Settings provides
explicit deletion. The adapter encrypts message payloads and private preferences
with a device-secured independent key and authenticated, versioned records.
Upgrades from mobile plaintext storage are transactional and resumable; unreadable
encrypted data is preserved rather than reset. There is no background delivery promise.
Protocol records are encrypted through a distinct async platform port, with
scoped keyed indexes and bounded paging. A confirmed identity wipe stops both
transports and cancels lifecycle resume before deleting local keys and data.
See [local storage](security/local-storage.md) and the
[compatibility inventory](protocols/compatibility.md).

Historical third-party notice snapshots are retained in source for provenance.
The mobile notice generator selects the locked mobile dependency closure and
preserves complete mobile framework notices; only generated referenced assets
are bundled. Copyright texts are not rewritten or replaced with app branding.
