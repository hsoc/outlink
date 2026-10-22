# Deleting a Nearby conversation

Open **Nearby → Contacts** and use **Delete conversation** on the person's card.
The confirmation explains that this deletes local messages and the draft and
cancels queued outgoing messages. It keeps the contact, favorite/verification
state, block settings and keys. The action also works for recent conversations
whose sender is no longer a retained contact. Cancel leaves everything intact.

Deletion covers every stored private message for that peer, including older pages
outside the current loaded window. Public Mesh messages, other contacts' DMs,
Location conversations and private groups are unaffected. Unread counts and the
Recent conversations entry disappear when no messages remain. A live/saved contact
still appears in its respective Contacts tab. New DMs can create a conversation
again; deletion does not block the sender.

Queued local sends are discarded, including persisted retry entries. A transmission
already handed to Bluetooth, a relay, or a courier cannot be recalled. Copies on
other devices remain. Already presented generic OS notifications are not removed
by this per-conversation action; they contain no sender or message content.

## Storage and races

Encrypted history adds a visible/deleted index while preserving existing message
ciphertext and associated-data contexts. Deletion scans the selected room in
bounded 200-row pages, yields during processing, and updates matches in an exclusive
transaction. It erases message content and retains only encrypted minimal replay
markers at the existing keyed room/message indexes. Read markers can still answer
replayed delivery; they never appear in normal history pages. Later status writes
cannot overwrite a marker and resurrect its content. Full history clearing or
identity erasure removes the markers too.

Private-message outbox invalidation is scoped to the selected peer; unrelated
queues keep running. The service invalidates outstanding history loads, serializes
deletions, guards sends started before deletion, and checks delayed message/status
merges against replay markers. New distinct arrivals after deletion remain usable.
Deletion publishes its UI removal after storage succeeds. Storage errors are
reported; a queue already discarded before a later history error stays canceled.

Only keyed indexes and encrypted markers remain, not message text or a plaintext
peer index. This is local content deletion, not a guarantee of forensic erasure
from filesystem snapshots, backups, OS clipboard copies or recipient devices.
