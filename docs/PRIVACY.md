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
identity/storage keys, relay copies, recipients' copies, or screenshots.
See [local storage](security/local-storage.md) for the full protection boundary.

No hosted Outlink naming or notification service is configured. Source and
protocol details: https://github.com/hsoc/outlink.
