# Automated interoperability checks — 2026-10-17

Scope: independent protocol/profile checks and simulated transports. Physical-device
testing is omitted at the maintainer's request. These results do not establish
compatibility with a particular released Bitchat Android/iOS binary or radio stack.
The public reference/profile and pinned source revision are in
[the Bitchat protocol document](../protocols/bitchat.md).

Covered behavior includes independent network-order wire vectors, a Noise-C
handshake vector, signed announcements/messages, tamper rejection, multi-hop
forwarding and deduplication, fragments/reordering, raw-DEFLATE limits,
simultaneous private handshakes, private delivery/read receipts, and geohash
signatures/channel validation and relay acknowledgments.

Expanded simulated bearer cases send maximum-length UTF-8 public and private
messages at 64-, 185-, and 512-byte GATT value sizes. These check fragmentation
and the raw packet transport contract; they do not measure real MTU negotiation.

Two failures found by these tests were corrected:

- A returning peer could retain a stable identity while having discarded its
  Noise state. Sessions now record the ingress of authenticated announcements;
  loss of that link invalidates dependent ephemeral ciphers/negotiations and
  marks peers offline until announced again. A fresh handshake is then required.
- Small-frame bursts could trip the existing 64-frames/second input limit.
  Per-link serialized transmission now paces to at most 48 frames in a rolling
  second. The ingress limit remains unchanged. Disconnect/stop cancels pacing
  waits, and queued sends fail instead of later appearing sent.

A restart regression verifies private messaging when the receiver returns with
the same identity. A cancellation regression checks that leaving terminates
paced/queued writes without producing late outgoing messages. Existing
fragment/handshake/rate/queue bounds remain in force.

Unverified: actual Android↔iOS BLE discovery/notification delivery, official-client
interoperability, native keychain/keystore migration, permissions, and OS lifecycle
behavior. JavaScript bundle exports and simulated radios do not exercise these.
