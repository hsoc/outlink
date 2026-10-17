# Mobile architecture

Outlink ships Android and iOS applications only. There is no desktop runtime,
account bootstrap, wallet, generic Nostr inbox, old Nearby session, or push
notification extension in the application dependency graph.

`src/app/` owns four screens: chat, appearance settings, bundled license notices,
and the root layout. They reuse the original shared controls and theme.
`src/services/bitchat/` owns the Bluetooth codec, fragmentation, Noise sessions,
receipts, and bounded in-memory room state. It talks directly to the retained
BLE port rather than suspending an unrelated messaging service.

`src/services/geohash/` implements geohash encoding/bounds, per-channel signing
keys, signed public events, and bounded WebSocket relay sessions. Public
location channels and encrypted mesh private conversations are separate data
paths. A user must explicitly join each transport. Relay endpoints are limited
to six secure WebSocket URLs. No location lookup or relay connection occurs on
ordinary launch.

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
visible message state is reset. Foreground resumption requires rejoining. There
is no permanent message database, automatic subscription to previous channels,
or background delivery promise.

Historical third-party notice snapshots are retained in source for provenance.
The mobile notice generator selects the locked mobile dependency closure and
preserves complete mobile framework notices; only generated referenced assets
are bundled. Copyright texts are not rewritten or replaced with app branding.
