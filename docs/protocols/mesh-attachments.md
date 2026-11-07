# Nearby images and voice notes

Tap the image icon beside **Send**, choose an image, then tap the same control
when it changes to a send icon. Tap the microphone icon to record a voice note
of up to 15 seconds, then tap its send icon. The microphone
is requested only when recording starts. Accepted voice notes play on demand.
Outlink accepts JPEG, PNG, WebP and MPEG-4 audio. The current limit is 96 KiB per
attachment. Large images are resized and converted to JPEG before sending.

Public Mesh attachments use the signed Bitchat v2 file packet. Anyone on the
mesh may receive and read them. Nearby DM attachments use the Bitchat private
media payload inside Noise and require the recipient's authenticated media
capability. Outlink never uses the older plaintext directed-file fallback.
Both transports reuse BLE fragmentation. Attachment bytes do not enter chat
history, Internet relays, courier mail, or the offline outbox.

The receiving app shows an offer with sender, type and size. It holds at most
eight offers in memory, with up to two per sender and a five-minute lifetime.
**Accept attachment** creates a temporary local preview file. If preview saving
fails, the offer stays available for another attempt until it expires. Receiving does not require microphone or photo-library permission.
**Decline** removes
the offer without writing its contents. Closing the preview, leaving the screen,
backgrounding, restarting or erasing the identity clears preview files. Public
visibility and recipient acceptance are independent. A successful send does not
prove that anyone accepted the attachment.

The MIT implementation was written against the [upstream file packet](https://github.com/permissionlesstech/bitchat/blob/5e9287fae1e5fea80ca741d4ea669829dc16f144/bitchat/Protocols/BitchatFilePacket.swift) and
private media wire format. [Live push-to-talk](live-voice.md) uses a separate stream. Attachment receipts
and resumption are currently unavailable.
