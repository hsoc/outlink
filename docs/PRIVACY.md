# Privacy and network behaviour

Outlink does not require an account, phone number, registered username, or
wallet. Device cryptographic keys are generated locally and stored in platform
secure storage. Appearance and nickname preferences are stored locally.

Nearby public messages and discovery announcements are visible within radio
range. Bluetooth private-message content is encrypted using Noise; compare
peer fingerprints before trusting sensitive conversations. Stable discovery
keys and nicknames can link a device across sessions.

Location channels are public internet chats. Joining connects to the displayed
Nostr relays; they can observe IP addresses, times, public keys, selected area
codes, nicknames, and message content. Channel signatures do not encrypt data
or prove physical presence. Separate channel keys do not prevent correlation
through nicknames or network metadata.

Location access is optional and requested only when choosing a location-channel
area preset (Region through Block). An empty bridge area is filled with the
six-character Neighborhood code from the same location fix. Exact
latitude/longitude are used locally to calculate an approximate area code and
are not stored or included in events. Manual area entry does not need location
permission. Foreground location and Bluetooth may still be subject to platform
permissions and radio metadata.

Favorite contacts may exchange a separate Nostr identity through encrypted
Bluetooth control messages or signed contact codes. Optional internet delivery
connects to the configured relays only after enabling it and joining Bluetooth;
relays observe IP addresses, timing, and addressed outer public keys, while
message content is encrypted. This option is disabled by default. Contact-code
scanning requests camera access only on an explicit scan and stores no images.

There is no internet push registration or background delivery guarantee. Connections
pause in the background and reconnect on return within the same app process
unless the Android background-connectivity switch is enabled with a joined mesh.
That option keeps Bluetooth and existing relay connections active, consuming more
battery and continuing to expose their usual radio/network metadata. A local
ongoing notification contains no contacts, messages, keys, or area codes. It
does not register for internet push. iOS and internet-only sessions still pause.
See [background connectivity](protocols/background-connectivity.md).
Messages, drafts, channel selections, relay settings, and nickname are encrypted
before being saved locally, using a separate key kept in device secure storage.
Appearance preferences remain unencrypted. Message/room indexes are keyed;
record counts, order, and approximate lengths remain visible. The running app
can access the key, so this is not an app lock. A backup restored without its
device key cannot decrypt these records; there is no key recovery feature.

Existing mobile plaintext history/preferences are upgraded in resumable batches
and the live databases compacted. This does not guarantee erasure of flash-storage
remnants or previous backups. Retired pre-redesign databases are not imported or
deleted. Settings → Clear local history deletes saved messages and drafts, not
identity/storage keys, contacts, queued outgoing messages, relay copies,
recipients' copies, or screenshots. Queued outgoing messages can still send after
clearing history. Settings → Erase identity and all local data also removes
contacts, queues, gossip and the old identity/storage keys. Remote copies and
flash-storage/backups remain outside this deletion boundary.
See [local storage](security/local-storage.md) for the full protection boundary.

No hosted Outlink naming or notification service is configured. Source and
protocol details: https://github.com/hsoc/outlink.


Courier and prekey delivery runs while Bluetooth is joined. Nearby authenticated
phones may retain opaque private mail for up to 24 hours. Prekeys reduce exposure
after their private keys are deleted; static-key fallback and the 48-hour duplicate
grace do not provide that immediate protection. Relays/carriers can still observe
traffic metadata. Keys and delivery state survive backgrounding. Active sessions normally pause;
the Android foreground-service option can keep a joined mesh active.

Gateway and public bridge forwarding are separate opt-in controls, disabled by
default. A bridge publishes only the author's explicitly bridge-enabled public
messages; Nearby only skips that message. Area relay selection defaults to the
pinned Bitchat directory, using a geohash's center rather than publishing exact
coordinates; selected addresses are displayed. Custom relays remain available.
Validated directory refresh is described below; Tor support is not implemented. Enabling the bridge also
opens encrypted courier drop subscriptions; relays see rotating recipient tags
and ciphertext. A gateway can retrieve drops for authenticated nearby peers.
See [courier/bridge behavior](protocols/courier-and-bridge.md) for limits and consent.

Optional area-private inboxes use the signed public channel identity. Their full
Nostr keys identify accounts, not verified people; nicknames and short IDs do not
authorize receipts. Channel identities now rotate daily, with 48-hour grace inboxes and authenticated
private migration for Outlink peers. Relay subscriptions can associate current
and grace keys; public events do not publish the migration link. Nicknames and
timing can still correlate activity. Private Nostr messages lack per-message
forward secrecy. See [rotation policy](protocols/channel-identity-rotation.md). Automatic area relay selection contacts the upstream HTTPS
directory while its internet feature is joined, exposing the fetcher IP to that
operator. Custom relay mode bypasses this download. Both use bounded foreground
connections; no push service is introduced.

Ordinary discovered contacts now have a 24-hour temporary lease rather than
indefinite automatic retention. Explicit saves/imports, favorites, verification
and blocks persist. Queued mail can retain encrypted identity metadata until it
settles; message history remains independent. Legacy ordinary discoveries receive
one recorded upgrade window. See [contact retention](protocols/contact-retention.md)
for expiry, directory visibility and deletion limits.

The main-screen app icon also supports immediate full local erasure with three
activations within 1.5 seconds, without confirmation. Settings retains its
confirmation dialog. See [quick erase](protocols/quick-erase.md) for scope and limits.

Public nickname mentions can trigger optional local notifications after receipt.
Previews omit message text, names and area codes; no push tokens are requested or
uploaded. Notification permission does not change background delivery limits.
See [mentions](protocols/mentions.md) for matching, duplicate-name behavior,
retention, rate limits and erasure cleanup.

Private Bluetooth groups encrypt content with a creator-managed epoch key;
authenticated Noise sessions carry invitations and key updates. Members receive
the roster and signing identities. Nonmembers can relay opaque group packets and
observe group ID, epoch, outer radio identity, timing and size. Membership persists
through disconnection, so the roster is not an online-user list. Group keys,
rosters, invitation decisions, histories and drafts are encrypted locally and
removed by full wipe; removal/leave cannot erase other members' saved copies.
See [private groups](protocols/private-groups.md) for consent, rotation, local leave,
retention, protocol limits and official-client differences.

Displayed nickname discriminators are prefixes of already-visible public identities,
not new stable wire metadata. Mesh and location identities can therefore have
different suffixes; location rotation changes its discriminator. Short suffixes
can collide or be imitated and do not establish trust. Your own header hides the
suffix for compactness; other participants' labels include it. Legacy plain-name
mentions may still alert multiple identically named users. See [nicknames](protocols/display-names.md).
