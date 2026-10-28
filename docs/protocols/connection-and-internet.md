# Connection reliability and internet private conversations

Independent MIT implementation against the protocol target in
[the compatibility inventory](compatibility.md). No upstream implementation
source was copied. These changes do not establish official-client or native
interoperability.

## Encrypted session replacement

A replacement Noise XX negotiation is reserved alongside the established cipher.
Failed writes, timeouts, malformed handshake messages and identity mismatches
reject the negotiation without destroying a working session. Simultaneous
initiations retain the existing deterministic peer-ID arbitration and preserve
waiting callers. At most sixteen handshakes are pending. Incoming initial
handshake messages are throttled per known identity; a second initial message
cannot restart a pending responder's timeout.

Only a completed, identity-checked handshake promotes its new cipher. One old
receive cipher remains for thirty seconds to accept in-flight ciphertext, with
its existing replay window. Old-session capability updates are ignored. Old
keys are destroyed on replacement, expiry or stop. Sessions attempt refresh after
fifty minutes, with a thirty-second retry interval, and expire after two hours
if no replacement succeeds. Losing one physical link preserves a cipher when
another direct link or a fresh mutual route remains.

Local capability changes are sent inside established encrypted sessions as well
as signed announcements. Once authenticated state has arrived, subsequent public
announcements cannot override its capabilities while that cipher remains active.
A replacement must establish its authenticated state anew. Direct courier trust
still requires the physical-link binding; preserving a cipher never creates one.

## Public-area private conversations

Internet private messages remain explicitly enabled in Settings and disabled by
default. While a public area is joined, the existing channel-specific Nostr key
also receives private kind-1059 envelopes on that area's relays. The public
message's **Private message** action opens a conversation with its full signed
Nostr public key. Incoming private conversations appear in the same area's
conversation selector. Nicknames are not an identity check; the full public key
is displayed. These conversations are separate from Noise/QR mesh contacts.

Messages reuse Bitchat's historical XChaCha v2 envelope and embedded private
packet codecs. As required for area DMs, embedded sender IDs are fresh random
hints and no recipient peer ID is embedded. The authenticated full envelope
sender owns the conversation and can acknowledge only messages addressed to that
exact key. Neither short IDs nor nicknames authorize a receipt. Private content
is never submitted as a public event or public mesh carrier.

Each channel identity has at most 100 conversations, 100 queued messages per
recipient, and 200 deferred receipts. Private text is limited to 4096 UTF-8 bytes.
The existing outbox stores before sending, retains entries for 24 hours, and
limits available-route attempts to eight, at least thirty seconds apart. Relay
acceptance means sent; only an authenticated recipient acknowledgment means
delivered/read. History commits before receive dedup and acknowledgment. Read
status never regresses to delivered. Failed receipts persist encrypted and retry
on reconnect, every thirty seconds, or on the next join. Recipient history is
paged and capped to 512 visible entries. Clear history retains delivery records;
identity wipe waits for writes and removes them with identity keys.

Mesh-favorite internet reception now also commits history and queues a durable
receipt before attempting delivery. Pending favorite/unfavorite notices can use
an already-known Nostr address when Bluetooth is unavailable and internet delivery
is enabled. Notices remain pending on rejection; a positive relay acknowledgment
clears that pending notice. This is relay acceptance, not recipient confirmation.

[Channel identities now rotate daily](channel-identity-rotation.md), with a
48-hour old-key delivery window and authenticated private migration for Outlink
peers. This is an additional Outlink privacy policy; the pinned upstream uses
stable channel identities. Existing clients retain standard message-format
compatibility but cannot confirm the migration extension. No claim of anonymity
or per-message forward secrecy is made. The inbox is active only while the area
is joined and its transport is running: normally foreground-only, with the
opt-in [Android background service](background-connectivity.md) exception when
a mesh is also joined. Push registration remains absent.

## Directory refresh

Automatic area-relay use fetches the upstream public CSV from the fixed HTTPS
address recorded in `RELAY_DIRECTORY_URL`. A valid cached directory is used for
24 hours; failures retry no more than hourly. Concurrent requests share one fetch.
Requests have an eight-second timeout and reject redirects. Input has a 512 KiB
text limit, at most 5000 rows, the expected CSV header, public DNS host syntax,
valid ports and finite latitude/longitude ranges. Conflicting locations for a
normalized host invalidate the update. No remote code or configuration is run.

A validated update is persisted before installation. The bundled directory and
last accepted cache remain usable on network, validation or storage failure.
Ranking retains great-circle distance and hostname tie breaking. Joined area
and bridge pools update their addresses while retaining unchanged connections;
removed sockets cannot deliver stale callbacks. Existing pending publishes still
need a positive acknowledgment or fail on their normal timeout.

There is no fetch at app startup or for Bluetooth-only operation. Custom relay
mode bypasses the directory. Automatic public channels check hourly while joined;
active gateways/bridges check through their foreground maintenance loop. Leaving
or backgrounding cancels a fetch; identity wipe waits for pending cache work.
The HTTPS directory operator can observe the fetcher's IP address, and the live
directory is trusted to supply public relay locations, not identities or message
contents. Tor and high-difficulty proof-of-work remain unimplemented.

## Automated verification

Regressions cover failed/successful reserved replacement, delayed old-session
traffic, encrypted capability updates, redundant physical links, private delivery
after sender departure, wrong-key receipt rejection, read receipts after a cold
restart, composition racing shutdown, directory validation/cache/backoff/cancel,
and relay-pool changes with stale callbacks. Physical testing remains omitted at
the maintainer's request. JavaScript exports do not prove native compilation.
