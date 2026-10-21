# Mobile architecture

Outlink ships Android and iOS applications only. There is no desktop runtime,
account bootstrap, wallet, old Nearby session, or configured remote push service.
Local mention alerts use the Expo notification SDK through a platform port; remote
registration and notification background modes remain disabled.

`src/app/` owns chat, contacts, private groups, settings, bundled license notices, native-link
handling, and the root layout. They reuse the original shared controls and theme.
`src/services/bitchat/` owns the Bluetooth codec, fragmentation, Noise sessions,
receipts, verification, durable contacts/outbox/gossip, and bounded in-memory room state. It talks directly to the retained
BLE port rather than suspending an unrelated messaging service.

`src/services/geohash/` implements geohash encoding/bounds, per-channel signing
keys, signed public events, and bounded WebSocket relay sessions. Public
location channels and encrypted mesh private conversations are separate data
paths. A user must explicitly join each transport. Each relay pool uses at most six secure WebSocket URLs. Gateway/bridge runtime
shares matching area pools and bounds the area pool cache; private mail uses a
separate configured/default pool. No location lookup or relay connection occurs on
ordinary launch. Optional private favorite delivery reuses the relay session in
a separate subscription mode; it is disabled by default and never bridges
private content into public channels.

Services use `src/platform/` for secure storage, asynchronous key/value
preferences, foreground location, lifecycle, notices, and BLE. Services do not
import React Native or Expo. The project-owned `modules/expo-proximity` native
module is retained because it supplies Bluetooth central/peripheral roles,
framing, and compression needed by Bitchat.

A new device identity is generated locally and kept in platform secure storage.
Bluetooth Noise/Ed25519 keys remain stable. Location signing keys are generated independently for each exact channel and
rotate daily with a bounded private delivery window. A shared nickname or public
radio behaviour can still link activity; rotation is not an anonymity guarantee.

By default, both transports stop on background. Pending operations are cancelled or rejected,
connections/timers are released, private session key material is cleared, and
message history is retained. Foreground resumption reconnects sessions that were
active before backgrounding. The opt-in Android connected-device foreground service
retains an already joined mesh and existing relay sessions, with an ongoing
notification, a scoped CPU wake lock, and an active Headless JS task for timers.
The platform port confirms native service state; failure falls back to pausing.
Internet-only sessions and iOS use the default pause/resume path.
See [background lifecycle](protocols/background-connectivity.md). Cold launch restores history and selections without
opening a transport until Join. History uses an asynchronous SQLite platform port,
indexed by keyed room/message identifiers and insertion sequence, with 200-record pages and a 500-record
visible window. Writes are incremental and serialized with reads and deletion.
Drafts are keyed per public/private mesh conversation or geohash. Settings provides
explicit deletion. The adapter encrypts message payloads and private preferences
with a device-secured independent key and authenticated, versioned records.
Upgrades from mobile plaintext storage are transactional and resumable; unreadable
encrypted data is preserved rather than reset. There is no background delivery promise.
Protocol records are encrypted through a distinct async platform port, with
scoped keyed indexes and bounded paging. An identity wipe stops both
transports and cancels lifecycle resume before deleting local keys and data.
Both the confirmed Settings action and the immediate triple-tap shortcut invoke
the same operation; see [quick erase](protocols/quick-erase.md).
See [local storage](security/local-storage.md) and the
[compatibility inventory](protocols/compatibility.md).

Historical third-party notice snapshots are retained in source for provenance.
The mobile notice generator selects the locked mobile dependency closure and
preserves complete mobile framework notices; only generated referenced assets
are bundled. Copyright texts are not rewritten or replaced with app branding.


Courier/prekey state and consented gateway/bridge routing live in the Bitchat
compatibility services, reusing Noise, protected storage, the private outbox and
relay session. Private prekey seeds stay behind the secure-storage port. An
origin signs public carrier events; gateways verify and forward those completed
events, never composing bridge copies of received radio chat. Public bridged
rows are marked and keyed by Nostr event ID, with radio hints used only for
replacement. Delivery receipts and contact updates are serialized so shutdown
can wait for work before an identity wipe. Protocol details and resource limits
belong in [courier and bridge](protocols/courier-and-bridge.md).

Session replacements preserve working ciphers until authenticated completion.
Area-private conversations reuse envelope/outbox/storage services but are scoped
to the area identity; mesh contacts and their verification state are not inferred
from Nostr nicknames. Directory refresh is foreground and internet-consent bound,
with validated persistent data and bundled fallback. Shutdown waits for private
message and directory-cache work before identity erasure. See
[connection and internet lifecycle](protocols/connection-and-internet.md).

Channel identity ownership belongs to a serialized secure-storage key-ring manager.
The running geohash service commits random keys before swapping public signers
and private inboxes, and drains maintenance before erasure. Private conversation
roots are separate from wire identities, preserving indexed history and queues
without whole-history rewrites. Only authenticated proof/acknowledgment changes
peer routes and acknowledged local signing identities. See
[channel identity lifecycle](protocols/channel-identity-rotation.md).

Contact persistence distinguishes explicit trust/save decisions from temporary
24-hour discoveries. Queue identity metadata survives until its pending mail is
settled; expiry cannot silently repin or authorize new sends. The directory uses
virtualized rows and bounded loaded-history data; see [contact retention](protocols/contact-retention.md).

[Public mentions](protocols/mentions.md) use the saved shared nickname and existing
plain-text messages. New-message callbacks feed a bounded notification service;
history hydration does not. The notification port isolates OS permission and
local scheduling from protocol code. Wipe invalidates/drains alert work and
attempts to clear only mention notifications before deleting local data.

[Private Bluetooth groups](protocols/private-groups.md) reuse the BLE bearer,
Noise control sessions, authenticated protected storage and opaque gossip cache.
Group membership and key epochs are serialized separately from network waits;
UI stores contain metadata, never symmetric keys. Group messages use their own
encrypted histories/drafts and never enter public, bridge, geohash or courier
send paths. Full wipe removes group state; history clearing retains membership.

The persisted nickname store publishes only completed storage reads/writes from
the serialized preference boundary. Chat/setup and mention highlighting observe
it directly instead of maintaining another asynchronous screen copy. Identity
erasure clears this transient store as well as the persisted preference.
