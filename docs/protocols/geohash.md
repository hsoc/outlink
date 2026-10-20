# Bitchat public geohash channels

Original MIT implementation of the public wire format, verified against the
upstream public protocol description and Nostr event format on 2026-10-17:
https://github.com/permissionlesstech/bitchat/blob/main/bitchat/Nostr/NostrProtocol.swift

No upstream application implementation was copied. This document describes the
supported subset, not a claim of implementing every Bitchat feature.

## Areas and events

Geohashes use standard longitude-first alternating coordinate bisection and
base32 `0123456789bcdefghjkmnpqrstuvwxyz`. Manual hashes accept 1–12 characters.
Foreground location offers precision 3–7: Region, City, District, Neighborhood,
and Block. Presets show approximate grid widths and also derive a six-character
Neighborhood code to fill an empty bridge area, without enabling bridging.
Area sizes vary with latitude; labels describe grid cells, not boundaries or
radio range. See [location selection](location-selection.md).

Public messages are signed Nostr kind **20000** events with `g` equal to the
exact lowercase channel and `n` containing the nickname. A random NIP-13 nonce
with target zero prevents identical sends in one second from sharing an event
ID. Presence is kind **20001**, empty content, and one `g` tag with no nickname.
Presence refreshes every 60 seconds. The displayed **Active recently** count
includes the local user once while relays are connected, plus up to 256 distinct
remote identities with signed presence or messages created within three minutes.
Relay duplicates, current/grace self echoes, and older replayed history do not
inflate it. Expiry is checked on new events and the minute heartbeat, so removal
can lag the three-minute threshold by up to a minute. Relays disconnected shows
unavailable; stopping resets the count. This is a channel-identity estimate, not
a verified count of unique people or people physically nearby. Separate devices,
identity rotation and limited relay visibility can affect the estimate.

Each channel uses independently generated secp256k1 identities, persisted in
secure storage and rotated every 24 hours while active or on the next join.
[Old-key delivery and private migration](channel-identity-rotation.md) preserve
bounded delivery continuity. No account or username provider participates.
Wire compatibility does not require clients to generate keys in the same way.

## Transport and validation

NIP-01 REQ filters include kinds 20000/20001 and exact `#g` matching. The initial
lookback is 15 minutes with a 200-event limit; ephemeral relays may return no
history. Signed timestamps beyond 60 seconds in the future or older than the
lookback, expired events, invalid canonical IDs/signatures, malformed tags,
and wrong/duplicate channel tags are rejected. Relays remain untrusted.

Messages are limited to 16000 UTF-8 bytes. JSON frames are capped at 32 KiB and
32 frames per second per relay before signature work. There are at most six
relays per session, eight pending publishes, 500 visible messages, and 2048 deduplication IDs.
Relays reconnect with bounded exponential delay while the channel is open.
Duplicate events from multiple relays are shown once. Late callbacks after
leaving cannot reactivate the session.

Publish waits up to eight seconds for an affirmative NIP-01 OK from any connected
relay. Negative replies from every attempted relay, timeout, or leave fail the
send unless an advertised Bluetooth gateway accepts a fallback handoff. That
handoff stays queued because it does not prove relay acceptance. Sent means a relay acknowledged acceptance, not that another person read
it. Bluetooth delivery/read receipts are independent.

## Deliberate omissions

A bundled public directory with validated cached refresh selects up to five nearby area relays by default;
custom relay addresses remain available. The [courier and bridge runtime](courier-and-bridge.md)
adds optional public gateway/bridge forwarding and encrypted courier mailboxes.
No high-difficulty proof-of-work mining, directory map, location
notes, media, moderation lists, Tor, or push delivery is included. Optional
[Android background connectivity](background-connectivity.md) retains open
relay sessions only while a mesh is joined. A relay requiring positive proof
of work may reject a publish; rejection is surfaced rather than shown as sent.
Do not treat a geohash tag, nickname, or signature as proof of physical location
or real-world identity. Channel contents and metadata are public.

Optional [area private conversations](connection-and-internet.md) reuse the
channel identity and encrypted private envelope codec, with separate inboxes and
history. Enable internet private messages in Settings before using them.
