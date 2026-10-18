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

Location access is optional and requested only through Use my location. Exact
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
pause in the background and reconnect on return within the same app process.
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
traffic metadata. Keys and delivery state survive backgrounding, not active sessions.

Gateway and public bridge forwarding are separate opt-in controls, disabled by
default. A bridge publishes only the author's explicitly bridge-enabled public
messages; Nearby only skips that message. Area relay selection defaults to the
pinned Bitchat directory, using a geohash's center rather than publishing exact
coordinates; selected addresses are displayed. Custom relays remain available.
No live directory fetch or Tor support is introduced. Enabling the bridge also
opens encrypted courier drop subscriptions; relays see rotating recipient tags
and ciphertext. A gateway can retrieve drops for authenticated nearby peers.
See [courier/bridge behavior](protocols/courier-and-bridge.md) for limits and consent.
