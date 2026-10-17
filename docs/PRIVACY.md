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
Messages are stored in a local SQLite database, and drafts/channel selections
in local preferences. Outlink does not encrypt this local history; device protection
and backup policy apply. Settings → Clear local history deletes saved messages
and drafts, not identity keys, other participants’ copies, or relay copies. Relays, recipients, device
backups, and screenshots may retain data after local clearing. Old app databases
are not automatically imported or deleted by this redesign.

No hosted Outlink naming or notification service is configured. Source and
protocol details: https://github.com/hsoc/outlink.
