# Contacts and discovery retention

The mesh composer shows Public Mesh, the currently selected private conversation,
and a Contacts button. It does not render the address book as horizontal tabs.
Contacts is also accessible from Settings and uses a virtualized, searchable list:

- **On mesh:** live, unblocked peers from the current mesh session. This can
  include multi-hop peers; it is not proof of physical proximity.
- **Saved contacts:** explicitly saved/imported, favorited, verified, or blocked
  identities, including offline contacts. Blocks remain manageable here.
- **Recent conversations:** deduplicated private correspondents from the loaded
  message-history window. This is not a search of all archived messages.

A private row opens the conversation while preserving its existing per-peer draft.
Save contact retains a discovered identity without automatically favoriting it or
claiming verification. Favoriting also saves it. A plain saved contact can be
removed from Saved; favorites must first be unfavorited. Verification and block
records remain persistent trust decisions. Importing a QR/contact code is an
explicit save. Verification still requires the existing authenticated procedure.
QR sharing/scanning remains behind an explicit add/share control in Contacts.

## Temporary discoveries

Ordinary discovered identities are encrypted temporary records with a 24-hour
lease. Metadata/live-encounter maintenance can refresh that lease; the application
avoids writing on every announcement. They never become Saved just because they
were discovered, sent a message, or were messaged. An offline discovery is absent
from On mesh, even before its temporary storage lease expires.

Existing records without an explicit-save marker are migrated by preserving
favorite, verified and blocked identities. Ordinary legacy discoveries receive
one 24-hour upgrade window, recorded before completing hydration. Restarting does
not reset that recorded deadline. This conservative window protects old pending
mail while removing the previous indefinite automatic-contact policy.

Sending a private message reserves identity metadata for the outbox's existing
24-hour delivery window, with one minute of key-retention margin. It does not
mark that identity as Saved. If an outbox still exists at contact expiry, its
identity metadata remains encrypted until the queue settles; expired contacts
are hidden from the directory and cannot authorize a fresh send. Maintenance
expires orphaned outgoing mail without transmitting and then prunes the temporary
record. Expired metadata is also checked on restore and opening Contacts.
Physical deletion is not promised while the app is closed, and does not erase
backups, memory, or remote copies.

An expired contact can still appear in Recent through retained message history.
The conversation remains readable, but a new message requires rediscovery or an
explicit contact-code import. Clear history does not delete trust decisions or
cancel existing outgoing queues. Confirmed identity wipe removes all local
contacts, temporary metadata and queues through the existing shutdown/erasure path.

The existing 1,000-contact quota remains; the menu has no old 50-row rendering
cutoff. Data processing is bounded to that contact inventory, the session's peer
map and the loaded message window. FlatList virtualizes rows; row memoization
keeps search/presence updates from needlessly rebuilding unchanged controls.

## Verification

Automated checks cover lease expiry/restart, one-time legacy migration, explicit
save/trust retention, failed persistence, queued-delivery key retention, safe
pending-metadata cleanup, tab isolation, search with identical names, blocked
identities and recent-history access after expiry. Static native-route checks
include the new Contacts route without accepting external peer/query parameters.
Physical-device UI testing remains omitted at the maintainer's request.
