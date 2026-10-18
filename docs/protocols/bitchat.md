# Bitchat live Bluetooth messaging

Outlink implements this interoperability profile independently under the
repository's MIT license. The target is complete current-main compatibility; that target is not yet
achieved. See the explicit [compatibility inventory](compatibility.md).

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
- Bitchat fragments, signed v2 source routes/flood fallback, incoming raw-DEFLATE payloads, padding.
- Noise-authenticated signing-key state (`0x21`).
- Signed link-local GCS public-history synchronization and encrypted durable cache.
- QR contact sharing/pins and live encrypted verification challenges (`0x10`/`0x11`).
- Encrypted durable outgoing private queue, favorites and block controls.
- Connection probes with nonce/sender binding and per-ingress response limits.

The separate geohash transport is described in [geohash.md](geohash.md).
Courier/prekey runtime and gateway/bridge carriers are implemented; see
[courier and bridge](courier-and-bridge.md) for lifecycle, consent and limits.
Groups, board posts, files, voice and rotating-ID presence remain unimplemented.
The outbox retries when a route becomes available; delivery is not guaranteed. Optional favorite internet delivery uses the independent private
envelope implementation described in the compatibility inventory.

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
| `0x04` | Up to ten direct-neighbor IDs, eight bytes each; advisory topology claims |
| `0x05` | Optional capability bits; Outlink advertises prekeys, plus gateway/bridge when enabled |

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
Contact identity pins are encrypted and persisted. Favorites and verified contacts
are pinned across restarts. Scanning pins both full keys; the verified badge additionally
requires the live encrypted challenge described in the compatibility inventory.

## Private sessions

Noise is `Noise_XX_25519_ChaChaPoly_SHA256` with an **empty prologue** and empty
handshake payloads. Outlink Nearby's `Outlink Nearby/1` prologue would be
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
| `0x10` | Verification challenge: one-byte TLVs `1` target Noise key hex, `2` nonce[16] |
| `0x11` | Verification response: same TLVs plus `3` Ed25519 signature[64] |
| `0x21` | Version `1`, then TLVs: `0x01` capabilities, `0x02` signing key |

On the BLE path, delivery/read receipts travel only inside the private session.
Reserved session replacement and encrypted capability updates are detailed in
[connection lifecycle](connection-and-internet.md). Their sender
must match the outgoing message's intended recipient before updating its status.
Private message IDs are deduplicated separately from outer encrypted packets.
Unknown private payload types are ignored. Files/voice/group payloads are not
advertised as supported and are not accepted.

## Mesh forwarding and resource limits

Packets originate with TTL 7; relays stop at TTL 1, exclude the ingress peer's
known links, and decrement TTL. Jitter/TTL classes match directed handshake,
directed encrypted, fragment and sparse/dense broadcast policies. A duplicate
cancels a scheduled relay. Broadcast fanout uses deterministic SHA-256-ranked
subsets per central/peripheral role; announce, fragment and RequestSync control
traffic retain full eligible fanout. Duplicate known-peer links collapse toward
the outgoing/write side except announcements, which bind every link.

Signed live neighbor claims form an advisory graph. Routes use only fresh
(one-minute), bidirectionally claimed edges and observed v2 peers, with at most
four intermediates. Outlink emits v2 announcements to signal decoder support.
Originated routes are signed after attaching the route and upgrading the header;
relays never rewrite or re-sign someone else's route. A missing next-hop link
falls back to flooding. Unconfirmed sends suppress routing after ten seconds
and use flooding for sixty seconds. Directed traffic uses a known direct link
when available. Such link hints are provisional and **must not** authorize
courier trust or destructive handover. Intermediates forward private ciphertext
without decrypting it.

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
frames per second per admitted link. Outbound link writes are paced to 48 frames
per rolling second; stop/disconnect cancels waiting writes. Losing an authenticated
peer's ingress invalidates its ephemeral cipher until a fresh handshake. Invalid inbound radio traffic is discarded
without injecting it into the user timeline. Local history persists until explicitly deleted in Settings. The visible
timeline is bounded to 500 messages; older records are loaded in indexed
200-message pages. Closing a room releases transport/session keys without
deleting its history.

## Privacy boundaries

Public messages, nicknames, static public keys, peer IDs, and presence are
visible over the radio. The static-key-derived ID is stable, so Bitchat mode
allows correlation of a device over time. Leaving stops presence but does not
rotate the stored local identity. A private message hides content, not recipient
IDs, timing, or mesh traffic volume. Bitchat traffic is never silently bridged
into public geohash channels.

Public internet area channels are documented separately in [geohash.md](geohash.md).

## Public-history synchronization

RequestSync (`0x21`) uses 16-bit-length TLVs for GCS Rice parameter, bucket range,
filter data, little-endian type mask, and optional timestamp cursor/fragment IDs.
Membership IDs hash type, sender, timestamp and decompressed payload. Requests
are signed, link-local, and never forwarded, including fragmented requests.
Outlink requests/serves verified announcements, public text and latest signed prekey bundles.
Responses retain original signatures, set mutable RSR, and use TTL zero; they
are accepted only during a locally requested sync window. Cached announcements
do not prove current reachability. Reply work runs outside the receive queue so
history transfer cannot block a Noise handshake.

The encrypted public cache retains at most 1000 packets/8 MiB, including at most 200 prekey owners; public text expires
after six hours and announcements after 15 minutes. Announcements are served
before messages and bypass a message cursor. Each ingress permits eight requests
per 30 seconds and at most one response task at a time.

## Connection diagnostics

Ping (`0x26`) and pong (`0x27`) carry a random eight-byte nonce and one-byte
origin TTL, with optional trailing extension bytes accepted. A pong must echo an
outstanding nonce and its claimed sender must match the probed peer. Hop count
is origin TTL minus received TTL plus one; inconsistent TTLs yield no estimate.
Probes expire after ten seconds and stop cancels outstanding probes. At most
sixteen local probes are pending. Replies are capped at five per incoming
physical link per ten seconds; rotating unsigned sender IDs cannot reset this
budget. These probes measure reachability, not authenticated identity.

Complete packets are entered into dedup only after acceptance, so a valid public
message arriving before its author announcement cannot poison later history
backfill. A full GCS filter omits the timestamp cursor; a cursor is used only
when the advertised newest prefix was truncated to its byte budget.
