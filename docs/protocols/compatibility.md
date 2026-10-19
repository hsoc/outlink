# Bitchat compatibility target

Target: official `permissionlesstech/bitchat` main at
[`5e9287fae1e5fea80ca741d4ea669829dc16f144`](https://github.com/permissionlesstech/bitchat/tree/5e9287fae1e5fea80ca741d4ea669829dc16f144).
Main is a moving target; this revision is the reproducible comparison point.
**Outlink does not yet provide 100% compatibility.** A byte codec alone does
not constitute runtime support. No optional capability is advertised until its
complete receive/send lifecycle exists. Physical testing was explicitly omitted
by the maintainer; automated vectors cannot establish native interoperability.

The implementation is independently authored under MIT. Upstream implementation
source is not incorporated. Published synthetic fixture data is included only
with revision/path/hash provenance in the test fixture directory. Existing
cryptographic primitives are reused rather than implementing ciphers.

| Area | Current implementation | Remaining for the full target |
| --- | --- | --- |
| BLE bearer, signed presence/public text | Android/iOS native bearer; raw packet framing, signatures, forwarding, tamper/dedup tests | Official-client/native interoperation remains unverified; adaptive scan/RSSI policies differ |
| Noise private text and receipts | XX handshake, reserved replacement with receive grace, counter replay protection, live encrypted capabilities, delivery/read receipts | Official-client/native verification remains outstanding |
| Wire packets | v1/v2 decode, raw DEFLATE receive, padding, signed source routing with flood fallback; absent/all-FF broadcast recipient | Outbound compression and larger media limits |
| Public history | Signed link-local RequestSync, GCS membership filters, durable encrypted announcement/text/prekey cache, rate-limited RSR backfill | Fragment/file/board/group sync caches and respective quotas/schedules |
| Contacts and verification | Signed expiring QR/link import/export, encrypted pins, encrypted live nonce challenge/response, favorite/block controls | Vouch and mutual-verification coordination; verification remains pending when offline |
| Outgoing private queue | Durable encrypted per-contact queue; bounded retries/expiry; authenticated receipt binding; offline composition | Official-client/native verification remains outstanding |
| Internet private messages | Custom historical v2/XChaCha kind-1059 envelopes, frozen iOS/Android fixtures; opt-in favorite/area inboxes, durable private outboxes/receipts, offline favorite notices, daily area identity rotation and private Outlink migration | Official clients do not implement the migration extension; recipient-confirmed favorite control delivery |
| Courier | Noise X seals, authenticated direct deposits, encrypted bounded mailbag, persistent spray budgets, direct/remote handover, recipient dedup and carried status | Official-client/native verification remains outstanding |
| One-time prekeys | Secure batches, signed monotonic bundles, persistent assignment/consumption, 48-hour grace, replenishment and bounded gossip | Official-client/native verification remains outstanding |
| Public geohash | Public kind-20000 messages, kind-20001 presence, relay ACK/reconnect, geohash selection, validated cached directory refresh | Full PoW policy and optional Tor behavior |
| Groups | Message type inventory only | Membership/key epochs/invites/rotation, authenticated group messages, UI, sync |
| Board | Message type inventory only | Signed posts/tombstones, retention/owner checks, UI and sync |
| Files/images/recorded audio | Message type inventory only | Public/private media formats, transfer/reassembly limits, encrypted storage, receipts and UI |
| Live voice | Message type inventory only | Voice bursts, codec/native audio pipeline, cancellation/order/timeout handling and UI |
| Diagnostics | Nonce-bound ping/pong, per-ingress reply budget, contact connection check | Official-client/native verification remains outstanding |
| Nostr carrier/gateway/bridge | Validated public carriers, consent controls, persistent uplink queues, loop/rate limits, two-island bridge and kind-1401 courier mailboxes | Tor and official-client/native verification remain outstanding |
| Identity erasure | Confirmed full local wipe stops sessions, invalidates foreground resume, removes encryption and identity keys | Platform storage/backup erasure is not guaranteed; remote copies cannot be erased |

`announceV2` (`0x2C`) is explicitly non-shipping in the pinned upstream, so
supporting that dormant format is not a prerequisite for current-main parity.
Encrypted persistent history is an intentional maintainer-requested difference
from upstream's default retention behavior. Android/iOS remain the only products;
website/desktop targets and push registration are outside Outlink's scope.

## Verification boundary

A QR signature binds displayed signing and Noise key bytes, but does not by itself
prove possession of the Noise private key. Import pins the contact; a verified
badge requires a fresh nonce response signed by the scanned signing key, received
inside a Noise session authenticated against the scanned full Noise key. Expired,
future-dated, ambiguous, tampered or wrong-destination links are rejected. An
offline saved contact stays unverified until a fresh code is verified while live.

## Queue and retention

A private message is stored before transmission. Each recipient has at most 100
pending messages, retained for 24 hours, attempted at most eight times with at
least 30 seconds between attempts. An unavailable route does not spend attempts.
Transmission or relay acceptance is not recipient delivery. Only authenticated
delivery/read receipts from that message's intended contact remove its entry.
A failed/expired message remains in conversation history with failed status.

Contact state, queues, and gossip records use encrypted protected records,
separate from user-clearable conversation history. Clear history does not forget
pins or cancel pending outgoing messages. The explicit identity wipe removes
both. Routine backgrounding cancels in-flight work and preserves records unless
the opt-in Android foreground service is retaining a joined mesh. See
[background connectivity](background-connectivity.md) for platform limits.

The implemented delivery paths and their limits are detailed in [courier and bridge](courier-and-bridge.md).

See [connection and internet lifecycle](connection-and-internet.md) for replacement, area DMs and directory refresh limits.

[Channel identity rotation](channel-identity-rotation.md) is an Outlink privacy extension,
not an official Bitchat wire requirement. Standard message formats remain unchanged.
