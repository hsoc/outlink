# Outlink

An MIT-licensed Bitchat-compatible messenger for **Android and iOS**. No accounts,
phone numbers, wallets, or username registration.

- **Nearby:** Bluetooth mesh public chat and Noise-encrypted private messages.
- **Location channels:** public Bitchat geohash chat and presence over Nostr.
  Enter an area code manually, or choose an approximate area using optional
  foreground location access. Exact coordinates are never included in events.
- The existing theme, typography, shared controls, light/dark modes, accents,
  and localized Bitchat strings are retained. New location copy falls back to
  English until translated.

Location channels require internet access and are public. They are separate
from encrypted Bluetooth private chats. There is no Tor integration, internet
private-message fallback, push delivery, file transfer, or background messaging.
Connections pause in the background and reconnect on return. Messages, drafts,
and channel selections survive restarts; Settings offers explicit local-history deletion.
Ephemeral Nostr events do not guarantee historical message retrieval.

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
· [Privacy](docs/PRIVACY.md) · [Security](SECURITY.md)

Original copyright notices and third-party license texts are preserved.
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
