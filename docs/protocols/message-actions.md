# Message actions and blocking

In Nearby and Location channels (public or private), press and hold message text
to open a small menu. A normal tap still inserts a mention. Long-press does not
also insert a mention. The action sheet supports OS Back, Cancel, and tapping the
backdrop; assistive technology can invoke the Message actions long-press action.

- **Copy message:** copies the exact message text, including line breaks, to the
  system clipboard. Your own messages offer this action only.
- **Message user:** opens the sender's encrypted private conversation. This
  replaces the inline Private message button in location chat. Nearby needs a
  known mesh contact; Location needs internet private messaging enabled. A bridged
  Nostr sender is not assumed to be a known mesh contact, so Nearby cannot open
  a Bluetooth DM for that bridge identity.
- **Hug user:** immediately posts `/me gives Alice a warm hug 🫂` to the current
  conversation, using the sender's displayed nickname in place of Alice.
- **Slap user:** immediately posts `/me slaps Alice around a bit with a large
  trout 🐟`, with the same nickname substitution. Whitespace in a nickname is
  collapsed to keep the generated action on one line.
- **Block user:** persistently hides received messages from that identity and
  suppresses future received-message alerts. **Settings → Blocked users** offers
  Unblock. Nearby contacts' pre-existing contact-block setting still applies
  independently and can be changed in Contacts.

Hug and slap use ordinary chat text starting with `/me`; no new protocol field or
command interpretation is required, and other clients may show the literal text.
They post in the pressed public/private conversation and preserve any draft.
Normal send limits, consent, route availability and errors apply. Message user,
hug and slap are disabled when their route is unavailable. Menus are dismissed
on navigation/erasure, and stale actions cannot execute in a different thread.

## Identity and persistence

Blocks are keyed by mesh peer ID or full Nostr public key, never by nickname.
Nostr keys are shared across the location and bridge display paths. Already
proven Location private-thread aliases are blocked together; further known aliases
are checked against that thread. Bluetooth group display also filters a blocked
mesh author's fingerprint. This is a local receive/display filter, not a request
to delete another device's messages or to stop opaque mesh forwarding. A new,
unlinked identity cannot be recognized as the same person automatically.

The block list and display labels use the existing encrypted protected-record
store. Block changes publish only after persistence, are serialized, and observe
identity-erasure cancellation. Network sessions restore these rules before
accepting messages. Old received history is hidden rather than deleted; unblocking
can reveal retained history. Full erasure removes the list and clears its memory.

Clipboard access reuses the MIT native module with no new dependency. iOS copies
are local-only rather than Universal Clipboard items. Copying intentionally takes
text outside encrypted app storage into the OS clipboard; full app erasure does
not promise to erase clipboard copies or text pasted elsewhere. An updated native
APK/IPA is required for Copy; older native builds report failure rather than
pretend to copy. Native clipboard/long-press behavior requires device verification.
