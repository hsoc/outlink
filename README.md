# Outlink

An MIT-licensed Bitchat-compatible messenger for **Android and iOS**. No accounts,
phone numbers, wallet accounts, or username registration.

- **Nearby:** Bluetooth mesh public chat, Noise-encrypted private messages, and
  invitation-based encrypted private groups. Open **Private groups** to create,
  accept invitations and inspect members. Buttons and `/group` commands are
  supported. See [private groups](docs/protocols/private-groups.md) for instructions,
  key rotation, offline behavior and the 255-member wire/official-client limits.
- **Cashu transfers:** send tokens prepared in an external Cashu wallet through
  Nearby encrypted DMs. Received tokens remain unverified until redeemed in that
  wallet. Both phones need Outlink support. See [instructions and limits](docs/protocols/cashu-transfers.md).
- **Location channels:** public Bitchat geohash chat and presence over Nostr.
  Enter an area code manually, or choose an approximate area using optional
  foreground location access. Region, City, District, Neighborhood, and Block
  show approximate sizes and fill the code directly. An empty bridge area also
  receives the Neighborhood code. Custom codes can be submitted with Join. Exact coordinates are never included
  in events. See [location selection](docs/protocols/location-selection.md).
- The existing theme, typography, shared controls, light/dark modes, accents,
  and localized Bitchat strings are retained. New location copy falls back to
  English until translated.

Location channels require internet access and are public. They are separate
from encrypted Bluetooth private chats. Optional internet private messaging and
mesh gateway/bridge features are disabled by default. There is no Tor integration,
remote push delivery or file transfer. Android offers an optional ongoing-notification
mode to retain a joined Bluetooth mesh and open relay connections in the background.
It is off by default; iOS and internet-only sessions pause and reconnect on return.
See [background connectivity](docs/protocols/background-connectivity.md). Messages, drafts,
and channel selections survive restarts; Settings offers explicit local-history deletion.
Ephemeral Nostr events do not guarantee historical message retrieval.

Tap **@Nickname** beside the app icon, or open **Settings → Nickname → Save**.
Duplicate active nicknames display four-character discriminators such as `Alice#7a2f`. New
profiles use `Outlink` (qualified only for active duplicates); retired random defaults are migrated. See
[display names](docs/protocols/display-names.md) for identity and privacy details.

For immediate erasure, tap the small Outlink icon at the top left of the main
screen **three times within 1.5 seconds**. This runs the same full-data wipe as
Settings, **without confirmation**. See [quick erase](docs/protocols/quick-erase.md).

Tap received message text to mention its sender. Press and hold for Copy message,
Message user, Hug user, Slap user, or Block user; see [message actions](docs/protocols/message-actions.md). Enable **Notify when
mentioned** in Settings for local alerts in mesh and location channels. A live
connection and notification permission are required. See
[mentions and notifications](docs/protocols/mentions.md). Viewed conversations stay
silent; unread dots identify other activity. Android can optionally notify for all
Nearby messages while background connectivity is running.

Nearby DMs appear in an unread sender strip and in Contacts; tap the sender to
open the private thread. Optional **Notify for private messages** in
Settings enables generic local alerts for Nearby and Location DMs independently of public mentions. Location private threads also show unread sender shortcuts and counts.

Use **Delete conversation** on a Nearby contact card to remove its local messages
and draft and cancel queued sends while retaining the contact. See
[conversation deletion](docs/protocols/conversation-deletion.md).

## Build

Use Node.js 24 and npm, then:

```sh
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run check:mobile
npm run export:mobile
```

A native development build is required for Bluetooth; Expo Go cannot provide
the project-owned BLE module. Use `npm run android:dev` or `npm run ios:dev`
and `npm start`. Production IDs remain `io.github.hsoc.outlink` on both platforms;
development uses `.dev`.

[GitHub Actions](https://github.com/hsoc/outlink/actions/workflows/build.yml)
provides Android APK builds and optional signed iOS IPA builds. See
[release setup](docs/RELEASING.md) for signing secrets.

## Implementation and limits

The Bitchat wire/session implementation is original MIT code. It uses existing
cryptographic libraries and the retained mobile BLE adapter; no upstream Bitchat
application source was copied. Protocol vectors and simulated radios are tested.
Real-device Bluetooth interoperability, background transitions, location prompts,
and signed distribution builds still require physical Android/iOS validation.

This mobile redesign does not migrate the retired Nostr account/chat database.
Old on-device data is not intentionally deleted. Back up any existing keys and
history with the previous app before upgrading; do not assume old conversations
appear in this version.

[Architecture](docs/ARCHITECTURE.md) · [Geohash protocol](docs/protocols/geohash.md)
· [Internet private messaging](docs/protocols/connection-and-internet.md)
· [Channel identity rotation](docs/protocols/channel-identity-rotation.md)
· [Compatibility and remaining gaps](docs/protocols/compatibility.md)
· [Privacy](docs/PRIVACY.md) · [Security](SECURITY.md)

Original copyright notices and third-party license texts are preserved.
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Local message history, drafts, and private preferences are encrypted with a
device-secured key; existing mobile history is migrated automatically.
See [storage protections](docs/security/local-storage.md),
[dependency review](docs/security/dependency-review.md), and
[automated interoperability results](docs/security/automated-interoperability.md).

See the [unused-code review](docs/maintenance/unused-code-review.md) for cleanup
scope and intentionally retained native compatibility paths.

The searchable [Contacts menu](docs/protocols/contact-retention.md) separates live
mesh peers, explicitly saved contacts, and recent conversations. Ordinary
discoveries expire instead of being saved permanently.

Chat histories expire locally after six hours; conversation windows load up to
512 messages. Cashu tokens and pending delivery records are kept separately.
