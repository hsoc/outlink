# Nearby images and voice notes

Choose an image, then send it to the selected Nearby conversation. To send a
voice note, record up to 15 seconds and tap **Send voice note**. The microphone
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
**Accept attachment** creates a temporary local preview file. **Decline** removes
the offer without writing its contents. Closing the preview, leaving the screen,
backgrounding, restarting or erasing the identity clears preview files. Public
visibility and recipient acceptance are independent. A successful send does not
prove that anyone accepted the attachment.

The MIT implementation was written against the [upstream file packet](https://github.com/permissionlesstech/bitchat/blob/5e9287fae1e5fea80ca741d4ea669829dc16f144/bitchat/Protocols/BitchatFilePacket.swift) and
private media wire format. Live push-to-talk, media receipts and transfer
resumption are separate features.
