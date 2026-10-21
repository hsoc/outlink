# Nicknames and discriminators

Tap **@Nickname** in the top bar to open **Settings → Nickname**, edit, and tap
**Save** (or the keyboard's Done action). This is the only nickname editor. Your
own header omits the discriminator and sits beside the app icon on every normal
screen except Settings. Pushed screens reserve an additional identity row inside
the top bar so long nicknames cannot overlap navigation/title controls. Names
truncate visually on narrow screens. Nearby and location setup no longer repeat
the name in their body. Identity erasure deliberately hides the old nickname.

Other participants normally appear as `Alice`. Only when distinct active users in
the current mesh or channel share a nickname do labels show `Alice#7a2f`. The four hexadecimal digits come
from the first four characters of the public identity relevant to that chat:
mesh peer ID/full Noise fingerprint, location Nostr public key, bridge public
key, or group member fingerprint. Short/full forms of one mesh identity yield
the same suffix. Existing claimed hexadecimal suffixes are replaced for display,
not trusted as identities. Contact search and group invite/remove commands accept
the displayed discriminated name. Duplicate or ambiguous matches fail locally.

The suffix is a display hint, not a globally unique username, proof of identity
or replacement for full fingerprint verification. Different identities can share
a short prefix. Location suffixes change with channel/identity rotation; no
additional stable cross-channel identifier or wire field is introduced. Other
Bitchat applications retain their own display conventions. QR payloads and wire
nickname fields still carry the base nickname and existing cryptographic identity.

New profiles use the persisted base **Outlink**, displayed as **Outlink**, with an identity suffix only for active duplicates. Retired generated defaults such as `Outlink1234`
migrate to Outlink. Custom names remain; explicitly saving a custom name in that
old digit format records an encrypted migration exception. A trailing hexadecimal
`#xxxx` through `#xxxxxxxx` is reserved for display suffixes and removed from the
editable base. Names are trimmed, nonempty and at most 64 UTF-8 bytes; the Settings
input also limits entry to 32 characters. There is no registration or name server.

## Save behavior

Nickname saving is independent of connection/reconnection and other network
settings activity. It does not wait for notification preferences to load. A ref
guard coalesces duplicate activations, the latest input/native Done value is used,
and a spinner indicates the single pending save. Edits invalidate delayed focus
loads so an older snapshot cannot replace newly typed or saved text. Save is
available with the keyboard open; success displays confirmation.

The serialized preference operation publishes the completed write to the shared
reactive nickname store. Header labels, chat setup and mention highlighting
update immediately, without Join. Failed writes preserve the previous saved
name; identity epoch checks prevent writes overtaken by a wipe from republishing
old data. Full wipe clears the preference, migration exception and transient
store. Initial loads do not publish an unsaved default.

Active mesh sessions use the saved name in signed announcements. Existing keys,
Noise sessions, contacts, history and relay sockets remain. Other peers learn a
rename through discovery. Startup reapplies the latest reactive name after
asynchronous connection setup so an in-progress Join cannot restore a stale label.
New messages and QR sharing read the saved preference. Existing messages and
queued payloads retain their captured base labels; presentation adds their identity
suffix. Private location envelopes do not gain a new nickname wire field.

Group incoming labels use the creator-signed roster base plus member fingerprint
suffix. That roster snapshot can lag a participant's current nickname until a
new signed roster arrives; see [private groups](private-groups.md).

## Mentions and verification

Tapping a public sender inserts the visible name, qualified only for active duplicates, such as
`@Alice#7a2f` or `@{Alice Smith#7a2f}`. Qualified matching requires the local
transport's exact suffix; a different suffix does not match the bare nickname.
Legacy bare `@Alice` still works and can notify multiple identically named users.
The saved nickname supplies the base for both highlighting and local alerts;
mesh alerts also recognize the device's current bridge alias. Suffixes remain
plain text to other clients. See [mentions](mentions.md) for notification limits.

Automated checks cover identity formatting, legacy default migration/custom
exceptions, qualified mention isolation, one-activation Settings save with pending
feedback, duplicate taps, delayed focus loads, independent preference loading,
header navigation, persistence failures, wipe cancellation, and live session names.
Physical/native touch behavior remains unverified; device testing was omitted.

## Active duplicates

Comparison ignores case, surrounding whitespace and Unicode normalization.
Saved contacts, old messages and offline group roster members do not create
collisions. The local active identity participates in duplicate detection; its
header still always shows the base. Mesh names follow live peer announcements.
Group names use active members of the selected roster. Location names come from
validated recent chat and expire with the existing three-minute presence window;
silent presence events do not advertise nicknames. Suffixes disappear again when
the duplicate leaves or expires. Full fingerprints remain available in contacts.
New qualified mentions use four hexadecimal characters; existing eight-character
mentions remain recognized for the current identity. A four-character prefix can
collide, so ambiguous group commands still require a full identity.
