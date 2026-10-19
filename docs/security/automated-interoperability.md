# Automated interoperability checks — expanded 2026-10-18

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


## Compatibility expansion

The suite additionally covers the upstream's frozen iOS and Android private
Nostr envelopes, published courier tag/TLV/signing vectors, Noise X static/prekey
domain separation, signed prekey bundle validation, and an independent GCS
bitstream. Fixture provenance records upstream paths, revision and SHA-256; only
published synthetic fixture data is included.

A partition regression checks public-history transfer after the original sender
has left, including the distinction between cached identity and live reachability.
A live encrypted verification exchange tests both full key pins without exposing
challenge/control payloads as chat. Public messages with an explicit all-FF
broadcast recipient retain their original signed bytes and display correctly.

Queue regressions cover concurrent quotas, offline/reopen persistence, retry
budgets/expiry, cancellation, recipient-bound receipts and immediate ACK races.
Private-mailbox tests check subscription isolation, absence of public presence,
relay acceptance, malformed events, deduplication, storage-error retry and stop.
Erasure tests cover key deletion, fresh storage keys, fail/retry behavior and
foreground-resume invalidation. These remain automated tests, not official-client
or physical-radio interoperability evidence.


Routing tests additionally cover fresh mutual edges, version gating, intermediate
hop limits, broken-route suppression/cooldown, independently ranked fanout,
link-local sync suppression and TTL/jitter classes. A simulated three-node chain
exchanges encrypted messages and receipts over signed originated v2 routes.
Connection probes are tested across a relay, on stop, and against a burst of
rotating forged sender IDs sharing one ingress link.


Courier/prekey and gateway/bridge runtime checks now include secure batch
publication, consumed-key persistence/grace, monotonic bundle replacement,
concurrent assignments, fixed mailbag quotas, persistent/replay-resistant copy
budgets, failed direct handover and remote cooldown. A simulated sender leaves,
a carrier reloads its mailbag, and the recipient later receives prekey-sealed
text without exposing content to the carrier. App-service checks verify carried
status, recipient-bound outbox removal and deferred acknowledgments.

Signed bridge events cross two simulated mesh islands through an emulated relay
and reach a mesh-only receiver exactly once. Tests cover passive downlinks,
consent/nearby-only, wrong directions/channels/signatures, loop suppression,
positive versus rejected relay acceptance, retryable drop opens, persisted dedup,
per-ingress budgets, bounded queues, gateway fallback status, and independent
relay-directory rankings. A history-partition test also guards announcement-race
and filter-cursor failures found during runtime integration.

Connection/internet regressions additionally cover reserved replacement failures,
delayed old-key traffic, live authenticated capabilities and redundant links;
area-private offline delivery, full-key receipt binding, durable read receipts
after restart, and shutdown racing composition; directory validation, cache age,
failure backoff, cancellation and relay replacement. See
[implementation limits](../protocols/connection-and-internet.md).

## Fault-injection expansion — 2026-10-18

- At simulated 64- and 185-byte MTUs, drop the first public-message fragment
  during an outage. No incomplete message is displayed. A signed, fragmented,
  link-local history request recovers the original signed text exactly once.
- Drop a Noise XX replacement response, expire the reserved negotiation and
  verify that the established cipher still delivers private text. Timeout events
  are controlled by the test; the suite does not wait fifteen wall-clock seconds.
- Disconnect both relay sockets during a pending send, reconnect replacements,
  and inject an old socket's delayed positive acknowledgment. It cannot mark
  the send accepted. The original times out; a new send succeeds on a live socket.
- Drop private recipient acknowledgments while returning relay acceptance, then
  retry the original saved message after its retry interval. Duplicate relay
  deliveries create one recipient history row, and a previously read message
  remains read while the sender's queue eventually clears.
- Feed the unchanged pinned official iOS and Android private-envelope fixtures
  through the real private inbox runtime at their authenticated fixture times.
  Validate the full sender/content and duplicate suppression. Verify all fixture
  file SHA-256 values against their pinned provenance.

These tests use deterministic fault schedules and assert user-visible delivery
states, history, privacy and cleanup. They exercise real Outlink codecs/sessions
with simulated bearers/relays, not official executables. Existing CI runs them
through the full Jest suite. No upstream implementation source was copied.

Channel-rotation coverage adds durable random key rings, clock rollback and failed
writes, bounded grace, concurrent manager creation and retryable key erasure;
public signer/subscription replacement without reconnecting; signed private
proof/acknowledgment binding, simultaneous rotations, cold restart with pending
migration, original-key outbox receipts, expiry/recovery, and rejection of expired
remote-key impersonation. This Outlink extension is not implemented by the
pinned official client; see [the protocol boundary](../protocols/channel-identity-rotation.md).

Background-connectivity lifecycle and platform-adapter tests additionally cover
permission denial, native startup failures, retained sessions, disabling while
backgrounded, lost service, internet-only fallback, identity-wipe invalidation,
opt-in persistence, and Headless JS stop races. These do not validate native
service/OS behavior; see [background connectivity](../protocols/background-connectivity.md).
