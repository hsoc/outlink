# Bitchat live Bluetooth messaging

Outlink implements this interoperability profile independently under the
repository's MIT license. This is **live Bluetooth mesh text messaging**, not
an implementation of every Bitchat feature.

## Reference and compatibility

The wire profile was checked against the public Bitchat reference at
[`5e9287fae1e5fea80ca741d4ea669829dc16f144`](https://github.com/permissionlesstech/bitchat/tree/5e9287fae1e5fea80ca741d4ea669829dc16f144):
`localPackages/BitFoundation/Sources/BitFoundation/{BinaryProtocol,BitchatPacket,MessageType}.swift`,
`bitchat/Protocols/Packets.swift`, `bitchat/Noise/NoiseProtocol.swift`, and the
BLE fragment planner. No source from that implementation is included in Outlink.
Packet constants and interoperable byte layouts are protocol facts. Cryptographic
primitives come from libraries already in Outlink, not newly written ciphers.

Implemented:

- Mainnet BLE discovery, simultaneous central/peripheral roles, signed presence.
- Signed public text, multi-hop forwarding, TTL limits, duplicate suppression.
- Noise XX private text, encrypted delivery acknowledgments and read receipts.
- Bitchat fragments, optional v2 routes, incoming raw-DEFLATE payloads, padding.
- Noise-authenticated signing-key state (`0x21`).

Not emitted or consumed: Nostr/geohash channels, courier envelopes, public
history/GCS synchronization, groups, board posts, files, voice, prekeys, gateway
carriers, or rotating-ID presence. These need separate interoperability profiles.
There is no offline delivery/outbox guarantee in this version.

Packet tests and simulated meshes pass; **physical interoperability with Bitchat
apps has not been established**. Wire compatibility does not establish audited
application security. Rebuild native modules/helpers before using this feature.

## BLE bearer

| Item | UUID | Operations |
| --- | --- | --- |
| Service | `F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C` | Advertise/scan |
| Packet characteristic | `A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D` | Write, notify |

Each GATT value contains an entire Bitchat packet or Bitchat fragment. The
Outlink Nearby transport's separate 12-byte chunk framing is **not** used.
Packets are fragmented against the negotiated value size, excluding ATT
headers; a link too small for a fragment header is rejected. The normal Nearby
UUIDs, profile exchange, framing, and authentication remain a separate mode.

## Packet bytes

Integers are big-endian except where stated otherwise.

| Field | Size |
| --- | --- |
| Version (`1` or `2`) | 1 |
| Type | 1 |
| TTL | 1 |
| Timestamp (Unix milliseconds) | 8 |
| Flags | 1 |
| Wire payload length | 2 for v1; 4 for v2 |
| Sender ID | 8 |
| Recipient ID, if flag `0x01` | 8 |
| Route, if v2 flag `0x08` | Count byte, then count × 8-byte IDs |
| Wire payload | Declared length |
| Ed25519 signature, if flag `0x02` | 64 |
| Optional padding | Up to 255 bytes |

Flag `0x04` means the wire payload starts with its original uncompressed length
(2/4 bytes by version), followed by **raw DEFLATE**, with no zlib header.
Decompression must return the exact declared size within a per-type ceiling.
Flag `0x10` is a mutable relay flag. Unsupported header bits are rejected.
This implementation accepts routes of at most 10 hops.

Ed25519 signs the unsigned packet encoding with TTL zero and relay flag clear,
including the reference encoder's padding. Removing the signature also removes
flag `0x02`; it is not sufficient to remove only the trailing signature bytes.
Original compressed payload bytes are retained for signatures and forwarding.

Padding targets the first of 256/512/1024/2048 that fits encoded length + 16.
Every pad byte equals the pad count; padding requiring more than 255 bytes is
omitted. Outlink emits padded Noise packets and natural-length public packets.
Signature preimages use padding even when their transmitted public packet does
not. Invalid trailing padding is rejected.

Outbound text is capped at **255 UTF-8 bytes**, for both public and private
messages. This matches private-message one-byte TLV lengths and keeps outbound
public signatures below the reference encoder's compression threshold. Incoming
public text can be larger within the decoder's 128 KiB ceiling. Outlink does
not emit compressed payloads.

## Identity, presence, and text

Bitchat has an independent X25519 static seed and Ed25519 signing seed for each
Outlink account. It never reuses an account's Nostr or Nearby identity keys.
Its peer ID is the first 8 bytes of SHA-256(X25519 public key). The full
32-byte digest is the fingerprint displayed to the user.

Announcement (`0x01`) payload uses `[type:u8][length:u8][value]` TLVs:

| Type | Value |
| --- | --- |
| `0x01` | UTF-8 nickname |
| `0x02` | 32-byte X25519 public key |
| `0x03` | 32-byte Ed25519 public key |
| `0x04` | Optional direct-neighbor IDs; ignored by this flooding implementation |
| `0x05` | Optional capability bits; Outlink advertises zero optional capabilities |

Unknown announcement TLVs are skipped; duplicates and malformed fields are
rejected. The announcement must be signed and its Noise key must derive the
header sender ID. Outlink's outgoing nickname is at most 64 UTF-8 bytes.

Public text (`0x02`) is UTF-8 in a signed packet. Messages from peers without a
valid announcement/signature are not displayed. Leave (`0x03`) marks a known
peer offline only after verifying its signature. Peers expire after 60 seconds
without a fresh verified announcement. Public-message timestamps are limited to a six-hour window relative to the
receiving device's clock; presence must be within one minute.

A self-signed announcement proves possession of its Ed25519 key, **not**
its claimed Noise key. Names/public-message authors are therefore provisional
until the peer proves possession of the Noise key. Private XX sessions check
that full static key. Authenticated signing-key state then supplies the
signing key through that established session. Users should compare fingerprints
before sending sensitive content; discovery alone is not in-person verification.
Remote identity pins are not persisted by this implementation.

## Private sessions

Noise is `Noise_XX_25519_ChaChaPoly_SHA256` with an **empty prologue** and empty
handshake payloads. Outlink Nearby's `PsstPsst Nearby/1` prologue would be
incompatible and is never used here. Directed handshake packets (`0x10`) carry
XX messages of 32, 96, and 64 bytes. For simultaneous initiations the smaller
peer ID retains the initiator role. A handshake expires after 15 seconds.

A session is accepted only if its authenticated remote static key equals the
announced full X25519 key. Directed encrypted packets (`0x11`) carry:

```text
counter:u32 big-endian || ChaCha20-Poly1305(ciphertext || tag[16])
```

The cipher nonce is `zero[4] || counter:u64 little-endian`, with empty associated
data. Send and receive keys are separate Noise split keys. Counters begin at
zero. Replay defense accepts out-of-order packets inside a 1024-counter window;
an invalid authentication tag does not advance the window. Counter exhaustion
requires a new handshake. Cipher keys are cleared on teardown/expiry.

Decrypted payload begins with one type byte:

| Type | Payload |
| --- | --- |
| `0x01` | Private-message TLVs: `0x00` message ID, `0x01` UTF-8 text |
| `0x02` | Read receipt: original message ID as UTF-8 |
| `0x03` | Delivery receipt: original message ID as UTF-8 |
| `0x21` | Version `1`, then TLVs: `0x01` capabilities, `0x02` signing key |

Delivery/read receipts travel only inside the private session. Their sender
must match the outgoing message's intended recipient before updating its status.
Private message IDs are deduplicated separately from outer encrypted packets.
Unknown private payload types are ignored. Files/voice/group payloads are not
advertised as supported and are not accepted.

## Mesh forwarding and resource limits

Packets originate with TTL 7. Relays decrement TTL, exclude the ingress link,
and jitter forwarding by 10–220 ms. A duplicate cancels a scheduled relay.
Dense broadcast nodes (six or more links) cap forwarded TTL at 5. Outlink uses
bounded full fanout rather than source-route computation/fanout subsetting.
Intermediates forward directed private ciphertext without decrypting it.

Deduplication excludes mutable TTL/relay flags and incorporates sender, type,
timestamp, addressing, and payload. Seen sets retain at most 1000 entries.
Public/handshake signatures are not bypassed when a packet is reassembled.

Fragment (`0x20`) payload:

```text
fragment ID[8] || index:u16 || count:u16 || original type:u8 || chunk
```

Fragments carry the original sender, recipient, and timestamp. Reassembled
headers must agree with the fragment envelope. Nested fragmentation, conflicting
chunks/counts, and sender substitution are rejected. Assemblies expire after
30 seconds, with at most 32 total, four per sender, 256 chunks each, approximately
128 KiB per packet, and 1 MiB total buffered. These text-oriented limits are
stricter than Bitchat's media limits.

Additional limits: 64 transport links, 256 discovered peers, 16 simultaneous
handshakes, 128 queued inbound packets, 128 scheduled relays, and 64 inbound
frames per second per admitted link. Invalid inbound radio traffic is discarded
without injecting it into the user timeline. Local timelines retain the last
500 messages and are cleared when the room closes.

## Privacy boundaries

Public messages, nicknames, static public keys, peer IDs, and presence are
visible over the radio. The static-key-derived ID is stable, so Bitchat mode
allows correlation of a device over time. Leaving stops presence but does not
rotate the stored local identity. A private message hides content, not recipient
IDs, timing, or mesh traffic volume. Bitchat traffic is never silently bridged
into Outlink's Nostr conversations, relays, or history exports.
