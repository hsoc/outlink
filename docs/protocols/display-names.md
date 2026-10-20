# Display names

Open **Settings → Public name / nickname**, edit the name, and tap **Save**.
Save works with the keyboard open; the keyboard’s Done action also saves.
A successful save dismisses the keyboard and displays confirmation.
This is the only name editor for both mesh and location channels. Setup shows
the saved name and a Settings link; joining never saves a second form value.
Names are trimmed,
nonempty, and limited to 64 UTF-8 bytes; the settings input also limits entry to
32 characters. New profiles default to `OutlinkXXXX`, where each X is a random
digit. Leading zeros are kept. The suffix uses rejection sampling over secure
random bytes to avoid bias. It reduces confusion but does not guarantee uniqueness.
No registration or server lookup is involved.

The preference `mobile.nickname` is saved before the default is used and reused
on subsequent launches. Existing names are preserved. Generation and edits share
the history operation queue with full-data erasure; lifecycle epoch checks cancel
operations overtaken by a wipe. Erasing all data removes the old preference;
Settings then generates a fresh default without creating a communication identity.
Storage failures surface an error instead of using an unsaved default.

Saving updates the active mesh session and emits its existing signed discovery
announcement when connected. Other peers learn the new name through discovery;
a temporarily disconnected peer can retain the previous label until rediscovery.
Noise sessions and device fingerprints are preserved. Location-channel messages
created after the edit use the new name without replacing keys or relay sockets.
Session startup, foreground restoration, and each new public post read the
current preference, so stale UI or resume snapshots cannot override it. If name
storage fails, the post fails before emitting a message. A changed transport
during the read cancels that post rather than sending into a different session. QR contact sharing
also uses the saved name.

The name is public metadata. Renaming does not provide anonymity, rotate an
identity, rewrite old messages or already queued payloads, or overwrite a name
another user has saved locally. Fingerprints remain the identity check.

Automated tests cover random sampling, concurrent initialization, persistence
failure, validation, wipe cancellation, signed mesh rename propagation with an
existing encrypted conversation, and location-event names with unchanged keys
and connections. Physical-device testing was intentionally omitted.

Location-channel setup displays Public name from this same saved preference,
including the `OutlinkXXXX` default on a new profile. It does not generate a new
name on each channel visit or silently replace a chosen name.

Location private messages use the shared nickname for their outgoing local label
instead of a public-key prefix. The existing private wire format does not carry
a nickname, so the recipient still identifies an unknown correspondent by their
authenticated key. No nickname field is added to that protocol. Existing history
and queued messages keep the label captured when they were created.

Regression tests exercise saved-name startup, posting after a persisted edit
without a direct rename callback, restart with a stale name snapshot, the signed
location event nickname tag and displayed local echo, and the local private label.
