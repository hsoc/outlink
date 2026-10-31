# Message actions and blocking

In Nearby and Location channels (public or private), press and hold message text
to open a small menu. A normal tap still inserts a mention. Long-press does not
also insert a mention. The action sheet supports OS Back, Cancel, and tapping the
backdrop; assistive technology can invoke the Message actions long-press action.

- **Copy message:** copies the exact message text, including line breaks, to the
  system clipboard. Your own messages offer this action only.
- **Message user:** opens the sender's encrypted private conversation. This
  works even before the private transport is ready. Nearby prepares contact details
  from discovered public keys without permanently saving or trusting the contact;
  missing details show a rediscovery hint. Location opens the private composer and
  offers an explicit Enable/Reconnect private messaging action when needed. Opening
  the conversation alone does not enable internet messaging. A bridged Nostr sender
  cannot be assumed to be a Bluetooth contact: an explanation offers Contacts instead.
- **Hug user:** posts `* 🫂 YourName hugs Alice *` to the current conversation.
- **Slap user:** posts `* 🐟 YourName slaps Alice around a bit with a large trout *`.
  Alice is the target's displayed nickname, with whitespace collapsed.
- **Block user:** persistently hides received messages from that identity and
  suppresses future received-message alerts. **Settings → Blocked users** offers
  Unblock. Nearby contacts' pre-existing contact-block setting still applies
  independently and can be changed in Contacts.

Hug and slap use Bitchat's ordinary `* ... *` action text with no new protocol
field. `/me text`, `/hug name` and `/slap name` expand at the service send boundary
for Nearby and Location public/private conversations, before size checks, signing,
persistence and local echo. The sender uses the current base nickname. Incoming
Bitchat actions retain their wire text. Legacy `/me text` history displays as
`* Sender text *` without rewriting received content or the exact Copy value.
They post in the pressed public/private conversation and preserve any draft.
Normal send limits, consent, route availability and errors apply. Hug and slap
are disabled when their route is unavailable; Message user is only disabled while busy. Menus are dismissed
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
