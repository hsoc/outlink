# Quick erase

On the main screen (Nearby or Location channels), tap the small Outlink app icon
in the leading header slot three times within a total of 1.5 seconds. On a
left-to-right screen this is the top left. The third activation immediately
calls the same `panicWipe()` used by Settings → Erase identity and all local data.
There is no confirmation dialog for this shortcut. The original Settings action
keeps its confirmation dialog.

One or two taps do nothing. Slow taps start a new sequence; blur, backgrounding,
and unmount reset partial sequences. The icon has a normal header-sized hit
target and an accessibility label/hint explaining the gesture. While wiping,
repeat triggers and navigation are disabled and conversations are hidden. A
failure displays a retry instruction instead of claiming success; another triple
activation retries the existing wipe operation.

The shared wipe invalidates pending resume intent, disables background
connectivity, stops mesh and relay services, drains tracked work, erases the
local encrypted store and identity keys, and clears contacts, messages, drafts,
and connection selections. The main screen also clears its private selection
and area-edit state. As with Settings, a fresh random nickname is then persisted;
no communication identity or connection is recreated until an explicit join.
Queued location-picker results are invalidated before the wipe starts.

This is local erasure. It cannot delete messages already received by peers or
relays, screenshots, or copies made outside the app, and is not a claim of
forensic erasure from device storage or backups.

Automated tests cover the activation window, incomplete/slow sequences, resets,
clock reversal, and invocation of the shared wipe only on the third activation.
Existing wipe tests cover coalescing, transport shutdown, deletion, failure, and
retry. Physical-device testing remains omitted at the maintainer's request.

Private Bluetooth group keys, rosters, invitations, revocation retry metadata,
drafts and histories are included in full local erasure. Group UI metadata and
message buffers reset with the other local stores. This cannot erase copies
already retained by group members or relays.
