# Mobile Bitchat lifecycle

The chat root offers Nearby and Location channels without account onboarding.
A device identity is created only when a session needs it. Bluetooth seeds use
secure storage; nicknames and appearance use asynchronous key/value preferences.

`BitchatService` owns one BLE session and its in-memory peers/messages. There is
no old Nearby service to suspend or account database to bootstrap. Session work
is serialized. On stop, timers/subscriptions are released, private session and
seed buffers are cleared, while messages remain in durable local history.

`GeohashService` owns an independent public-channel session. Switching the visible
tab does not silently create or bridge sessions; only Join opens a transport.
An explicit Leave closes that transport without deleting messages or drafts.
App backgrounding pauses both; returning reconnects previously active sessions.
Cold launch restores saved timelines and selections, requiring Join for networking. Merely visiting Settings does not disconnect active sessions.

The geohash permission action computes a coarse area locally; it does not join
the channel until the user presses Join. Manual entry remains available when
location permission is denied. Selecting a small area is a public location
choice; the app does not verify that a participant is physically present there.
