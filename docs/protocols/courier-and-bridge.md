# Courier, prekeys, gateway and bridge

Independent MIT implementation targeting Bitchat
[`5e9287fae1e5fea80ca741d4ea669829dc16f144`](https://github.com/permissionlesstech/bitchat/tree/5e9287fae1e5fea80ca741d4ea669829dc16f144).
No upstream implementation code is incorporated. Published wire fixtures and
public relay-directory data have pinned provenance. This does not establish
physical interoperability or complete feature parity.

## Using the features

Courier handling runs while Bluetooth is joined. Private text composed for an
offline saved contact enters the encrypted outbox. Outlink first tries live
Bluetooth, then optional favorite internet delivery, then sealed courier mail.
Nearby eligible carriers are authenticated before a deposit. They can deliver
later when the sender is absent. Leaving/backgrounding preserves queued and
carried mail; cold launch still waits for Join before opening transports.

Settings → Offline delivery and internet links provides separate controls:

- **Share internet messaging with the mesh**: an opt-in gateway for signed public
  geohash events. Set a public area to receive its messages onto Bluetooth.
  Signed uplinks for other areas can also be published, within queue/rate caps.
- **Connect separate nearby meshes**: an opt-in public bridge for a six-character
  geohash cell, plus private encrypted courier mailboxes. Only messages composed
  by the user are additionally signed for this bridge. Other radio messages are
  never automatically exported. **Nearby only for this message** skips that
  outgoing bridge copy and resets after sending.
- Both sharing switches default off. Mesh-only phones can use an advertised
  gateway for locally signed geohash messages and receive public bridge carriers
  without enabling internet forwarding themselves. Bluetooth must be joined.
- **Use Bitchat area relays** defaults on: choose up to five nearest directory
  entries by great-circle distance to the geohash center, breaking ties by host.
  Default-port aliases are normalized. Disable this to use the custom relay
  list for area/bridge traffic. Courier drops use the configured/default private
  relays. Area relay addresses are shown before joining a public channel.

The bundled directory contains 441 public address/location entries from the
pinned reference; [provenance](relay-directory-provenance.json) records its source
and checksum. Automatic area-relay mode now refreshes this public directory with validation,
a durable cache and bundled fallback; see [refresh lifecycle](connection-and-internet.md).
Upstream directory changes can change rendezvous relay selection. There is no Tor implementation.
Area sockets are shared when bridge and gateway use the same hash. Up to three
area pools are retained, with configured areas protected from eviction by a
neighbor's uplink; each pool has at most five addresses. The private/custom pool
has at most six. All connections pause in the background.

## Delivery state

`Queued` means retained for a future route; a geohash gateway handoff also stays
queued because its BLE acceptance does not prove relay publication. `Sent`
means a direct bearer accepted the packet or at least one relay returned a
positive NIP-01 `OK`, not recipient delivery. `Carried` means a courier accepted
a sealed copy or a relay accepted a courier drop. Only an authenticated delivery
or read acknowledgment from the intended recipient clears private outbox mail.

Private outboxes retain at most 100 messages per contact, for 24 hours and at
most eight available-route attempts, spaced by at least 30 seconds. Courier
metadata (sealed bytes, distinct depositors, relay acceptance) persists with its
outbox entry. Retries reuse that seal rather than consuming another prekey.
Up to three distinct courier Noise identities receive a message. Deferred
acknowledgments are encrypted, capped at 100 per sender and expire after 24 hours;
a read status cannot be overwritten by a concurrent delivery acknowledgment.

## Prekey lifecycle

The existing Noise X codec seals to either a recipient static key or a signed
one-time X25519 prekey. Both use their upstream domain-separated prologues.
Prekeys are preferred when a fresh authenticated bundle is cached; static-key
fallback remains interoperable but does not provide forward secrecy.

Private prekey seeds persist in secure storage under the local identity root.
An initial batch has eight unused keys; it replenishes when fewer than three
remain. Generated timestamps strictly increase, including same-millisecond
consumption. IDs never wrap/reuse. A key is consumed only after successful
ciphertext authentication, and that state commits before delivery. Consumed
keys remain for 48 hours to accept duplicate deliveries, then are pruned; unused
keys rotate after 30 days. At most 256 consumed grace keys plus eight unused keys
are retained. Exhausting that grace quota fails closed rather than discarding
unexpired keys. Forward-secrecy benefits begin when the private key is deleted.

Public bundles require matching owner/sender Noise identity and valid inner and
outer Ed25519 signatures against the announce-bound key. A bounded pending cache
handles bundles racing announcements. The sender remembers used IDs and per-message
assignments across restart. Newer bundles preserve assignments still offered;
older generations cannot replace them. The cache holds 200 owners; sealing uses
bundles no older than seven days. Gossip serves at most 200 latest owner bundles
for 24 hours, alongside public announcements/text.

## Physical couriers

Courier packets (`0x04`) are directed. The receiver first checks its candidate
recipient tags for the previous/current/next UTC day. Noise X authenticates the
original sender inside the seal; blocked full Noise identities are rejected.
Duplicate inner message IDs do not create duplicate conversation entries.

A deposit for someone else requires an outer signature, the claimed sender to
match the ingress binding, and a Noise-authenticated direct physical link.
Routing hints alone cannot authorize deposits or destructive handover. Favorites
receive five slots each; other authenticated, signature-bound peers receive two,
within a 20-slot tier that cannot evict favorite mail. Total capacity is 40
opaque envelopes; ciphertext is at most 16 KiB and local retention is 24 hours
with a one-minute expiry-skew allowance.

The copy budget starts at four and is clamped to eight. Spray transfers half the
remaining budget to a newly encountered eligible carrier, excluding the depositor
and recipient. Spent budget and spray identities persist. Budget is reserved
before a potentially ambiguous radio write: a crash may lose a copy but cannot
mint extra copies. Replaying an original deposit cannot replenish a sprayed
budget. Direct authenticated recipient handover removes an accepted copy;
remote handover retains it and is throttled for ten minutes. Local expiry and
quotas prune mail independently of conversation history.

## Public carriers and relay mailboxes

Nostr carrier (`0x28`) TLV16 fields are direction, geohash, and complete signed
event JSON, capped at 16 KiB. Directions 1/2 carry public geohash uplink/downlink;
3/4 carry public bridge uplink/downlink. The originator signs the Nostr event;
uplink packets additionally need their radio sender's signature at the gateway.
Broadcast downlinks are self-authenticated by their Nostr signatures, so they do
not depend on first hearing the gateway's announcement. Private content never
enters the public carrier path.

Bridge events use kinds 20000/20001 and an `r` cell tag, separate from ordinary
geohash `g` subscriptions. The optional `m` tag is only a radio-copy hint. Rows
are keyed by the signed Nostr event ID; a copied hint cannot suppress an authentic
radio message. A later authentic radio copy replaces corresponding bridge rows.
Bridge rows are visibly marked. Own rendezvous identities are recognized across
restart. Carried/previously published events are not re-exported, and relay
self-echoes are suppressed while publication is in flight and after acceptance.

Gateway queues persist encrypted public events: 20 total, five per depositor;
uplink admission is limited to ten per physical ingress per minute. Events expire
after fifteen minutes. Downlink queues hold at most 30 events, with separate
30/minute geohash and 20/minute bridge budgets and periodic draining even when
the channel becomes quiet. A bounded pre-crypto budget and per-signer quotas
limit relay processing. Subscription refresh compares channel/tag membership,
not a moving lookback timestamp, avoiding repeated history downloads.

Bridge courier mail uses kind 1401, an `x` recipient tag, standard Base64 envelope
content and an expiration tag. Each publication has a fresh throwaway signing
identity; the inner Noise X seal authenticates its sender. Receivers verify the
event signature, envelope limits and agreement between inner and outer tags.
They watch their own three daily tags; bridge gateways additionally watch at most
16 authenticated local identities. A matching local drop uses an authenticated
direct handover. Failed opens/writes remain retryable. Processed event IDs persist
in a bounded expiry-aware cache; outgoing dispatch marks relay acceptance only
after positive `OK`. Held courier mail republishes at most every thirty minutes
and commits its cooldown only after relay acceptance.

## Storage, shutdown and checks

Contacts, public bundles, mailbags, outbox dispatch, relay queues, dedup state and
acknowledgments use encrypted protected records. Private prekey seeds use secure
storage. Clear history keeps these delivery records, as stated in the UI. The
confirmed identity wipe stops transports, waits for protocol work and contact
mutations, invalidates queued joins/resume, and removes both protected records
and private prekeys with the old identity keys.

Automated checks include published crypto vectors, consumed-key grace/restart,
assignment races, quotas, replay-resistant copy budgets, failed handovers,
relay acceptance, signed two-island bridge traffic, passive mesh-only delivery,
gateway loop prevention, wrong-channel/signature rejection, directory ranking,
and offline app-outbox integration. Physical-device and official-binary testing
remain omitted as requested; native compilation is not established by JS exports.
