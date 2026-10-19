# Display names

Open **Settings → Your name**, edit the name, and tap **Save**. Names are trimmed,
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
Foreground session restoration reads the current preference. QR contact sharing
also uses the saved name.

The name is public metadata. Renaming does not provide anonymity, rotate an
identity, rewrite old messages or already queued payloads, or overwrite a name
another user has saved locally. Fingerprints remain the identity check.

Automated tests cover random sampling, concurrent initialization, persistence
failure, validation, wipe cancellation, signed mesh rename propagation with an
existing encrypted conversation, and location-event names with unchanged keys
and connections. Physical-device testing was intentionally omitted.
