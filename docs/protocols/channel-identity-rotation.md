# Channel identity rotation

Outlink changes the identity used for a public geohash channel every 24 hours of
wall-clock time, when the running joined app next checks it or sends. The
maintenance timer checks each minute; a cold join rotates an overdue identity
before publishing. Different channels have independent identities. Mesh Noise
identities, QR contacts, favorite-internet identities and bridge rendezvous keys
are unchanged.

This is an independently authored MIT privacy extension. The pinned official
Bitchat [identity bridge](https://github.com/permissionlesstech/bitchat/blob/5e9287fae1e5fea80ca741d4ea669829dc16f144/bitchat/Nostr/NostrIdentityBridge.swift)
uses stable per-channel keys; it does not define this migration handshake. Public
messages and normal private envelopes retain their existing Bitchat formats.
No upstream implementation code is incorporated. Automatic private migration is
an Outlink-to-Outlink extension, not a claim of official-client support.

## Key lifecycle

Each new identity has a random secp256k1 private key, committed to secure storage
before any use. Old random keys cannot be regenerated from the permanent device
root. The root namespaces the secure entries; it is not the rotating-key seed.

A retired key has a 48-hour delivery window starting at its actual replacement.
An overdue current key is retired when the app returns, allowing fresh queued
mail to its old address to arrive during that window. Previously retired,
expired keys are never revived. A key ring retains one current and at most two
retired keys. Expired retired material is pruned on that area's next load/check;
there is no promise of deletion while the app is closed or the area is inactive.
Existing deterministic channel keys receive one initial 48-hour transition window.

The secure index is capped at 32 retained channel key rings. Corrupt data,
exhausted quota, and failed persistence surface an error instead of silently
resetting identity. Concurrent creation and rotation are serialized across
manager instances. Clock rollback retains the already committed current identity;
it never selects an older identity. No permanent-root derivation is used to
recover a discarded random key.

A joined session replaces its signer and inbox subscriptions without reopening
unchanged relay connections. Public events contain no previous-key or migration
tags. During grace, private inboxes watch at most three local recipient keys.
Own public events from those grace keys remain recognized as outgoing.

## Preserving private conversations

A private thread has an immutable local conversation root, a current remote key,
up to four recent key aliases, and the local identity the peer last acknowledged.
The root is internal encrypted metadata, never a public tag. Messages retain the
actual sender and recipient keys used on the wire, plus their conversation root.
Older history does not need to be scanned or rewritten at rotation.

Before sending under a new local key, Outlink sends an encrypted migration proof
from the old identity to an existing private peer. The peer verifies both old-key
authentication and new-key possession, then acknowledges to the new inbox using
an identity the sender already knows. Only that authenticated acknowledgment
switches the sender's local identity for that conversation. A known peer directly
contacting an expired pair's current inbox can also renew that conversation.

Relay acceptance alone does not complete migration. Until confirmation, new
private messages continue using the acknowledged old local identity while it is
available. Outgoing entries and delivery/read receipts retain their original
identity and full intended recipient. Migrating to a new remote key does not let
that key acknowledge messages addressed to the old key. Clearing history retains
outgoing entries; authenticated receipts can still clear those entries.

The receiver extends only its current remote-key chain. An exact retry of the
latest edge is idempotent; stale forks, cross-area proofs, expired/future proofs,
unknown senders, and collisions with another established conversation are
rejected. The old remote signing key is accepted only during its authenticated
grace window. Keeping a historical root or alias does not authorize indefinite
impersonation using an expired remote key. A peer may advance its chain at most
once per hour. Full keys, not nicknames or short IDs, authorize changes.

Pending proofs and acknowledgments are encrypted protected records: at most one
of each per private thread (200 total for 100 threads). Publications reserve an
attempt before a potentially ambiguous relay write, retry at most hourly, and
are capped at 48 attempts and their proof expiry. Failed handshakes survive
restart. New proof generations supersede old pending ones; acknowledgments bind
the exact proof ID and destination identity. Coalesced drains do not lose a
wakeup when a control arrives during an existing flush.

## Private extension format

The extension remains inside the existing authenticated kind-1059 private
envelope and embedded type-17 packet. Its payload is `0xF0`, version `1`, then
bounded UTF-8 JSON, with a random embedded sender hint and no recipient peer ID.
Control JSON decoding is capped at 4096 bytes. Controls are never displayed as
chat text by Outlink.

A proof is an internally signed Nostr-shaped kind-30078 event, **never published
as a public event**. Its signer is the new key; exact tags are:

```
["d", "outlink/channel-rotation/v1"]
["g", "<exact channel hash>"]
["p", "<previous full public key>"]
```

Content is `{version:1, previous, created, expires}` with millisecond times;
`created_at` is the corresponding floored second. The old-key private envelope
carries `{kind:"rotation", id:<proof event ID>, proof, ...}`. The reply is
`{kind:"rotation-ack", id:<same proof ID>, previous, next, ...}` and must arrive
at the proven new local identity. Future skew is limited to one minute; proofs
expire within 48 hours. Signing and envelope primitives are reused, not replaced.

The pinned official decoder ignores unknown typed private payloads, so it cannot
confirm this extension. With such clients, standard private text remains usable
under the old identity during grace. After expiry, Outlink keeps the history and
shows an explicit **Continue with current identity** action. That action can
appear as a new conversation in the other app; it does not claim verified
continuity there. No silent fallback merges an unrelated remote identity.

## Privacy and shutdown limits

Public channel events do not disclose the migration link. Existing private
contacts intentionally learn it. Relays can associate current and grace inbox
keys from subscriptions on the same connection, and can also observe IP address,
recipient tags and timing. Nicknames, writing style, public content and mesh
fallback metadata can link activity despite rotation. This is not anonymity or
per-message forward secrecy. Retained encrypted history and native backups have
separate confidentiality/erasure boundaries.

Backgrounding normally stops connections and retains delivery state. The opt-in
[Android foreground service](background-connectivity.md) can keep an already
joined mesh and open private relay transports active, including identity maintenance. Join, secure key writes, identity maintenance,
private messages and receipts are drained before confirmed identity erasure. The
wipe removes every indexed channel key ring and its index together with the old
root; in-memory byte buffers are cleared. JavaScript strings, platform keychain
backups and forensic erasure are not guaranteed.

## Verification

Automated tests cover persistence before use, daily rotation, cross-channel
separation, bounded grace, clock rollback, concurrent managers, corrupt/failed
storage, retryable erasure, public signer changes, subscription updates without
reconnecting, cold restart and rotation racing erasure. Protocol tests cover
proof tampering, wrong area/sender/time, simultaneous migration, delayed controls,
new-inbox acknowledgment binding, pending mail's original signing key, historical
read state, expiry, explicit recovery and expired remote-key impersonation.
Native compilation and official-binary/device interoperability remain unverified;
physical testing stays omitted at the maintainer's request.

Validation for this change: 153 tests across 29 Jest suites, TypeScript, clean
lint, storage/mobile configuration checks, 734-notice consistency, and Android
and iOS JavaScript/Hermes bundle exports passed.
