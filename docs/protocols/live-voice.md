# Nearby live voice

In Public Mesh or a Nearby DM, tap the headphones icon beside **Send** to hear bursts in
that conversation. Listening starts off and resets when you switch conversations,
leave the screen, or background the app. Hold the radio icon while speaking and
release to stop. The first hold requests microphone permission if needed. Hold
again if the permission dialog interrupts the gesture. A burst lasts at most
15 seconds. The app pauses live playback while you talk.

Public Mesh bursts are signed and audible to anyone on the mesh who chooses to
listen. Nearby DMs require an established Noise session before microphone
capture starts. Intermediate nodes forward private frames as ciphertext. Live
voice travels only over Bluetooth, with no courier, relay, attachment, or history
storage. Poor links may drop frames. Live voice does not produce a saved
recording or a delivery receipt.

Outlink uses the upstream [Bitchat voice burst format](https://github.com/permissionlesstech/bitchat/blob/5e9287fae1e5fea80ca741d4ea669829dc16f144/bitchat/Protocols/VoiceBurstPacket.swift).
Both native platforms encode AAC-LC at 16 kHz mono and decode to live playback.
Public packets use outer type `0x29`; private packets use Noise payload type
`0x08`. The receiver accepts one speaker at a time, drops stale and duplicated
packets, and bounds capture, transmission, and playback queues. Physical radio
and cross-client audio behaviour require device validation.
