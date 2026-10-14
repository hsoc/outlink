# Bitchat implementation

## User flow

Open **Nearby → Bitchat → Join nearby room**. Choose a public name, keep
Bluetooth enabled, and bring another Bitchat device nearby. The public room
is readable by the mesh; select a discovered person's name for private chat.
A private send establishes Noise automatically, then encrypts the typed text.
The selected device's full fingerprint is selectable for manual comparison.

The composer enforces a 255-byte UTF-8 limit, including multi-byte characters.
A user's public-name input is limited to 16 characters; the protocol accepts
up to 64 UTF-8 bytes for Outlink's outgoing name. UI strings are localized in
all 19 shipped languages. Shared screen, input, button, text, and theme
components support light/dark modes; no new UI library is introduced.

This is a foreground, session-only room. Messages are not inserted into the
Nostr/Nearby database or exported chat archives. Leaving, changing accounts,
backgrounding, or navigating away stops the bearer and clears the bounded timeline. Public
and selected private conversations are separate views. Delivered/read statuses
can only be changed by the intended Noise-authenticated recipient.

## Reuse and package size

No dependencies, vendored upstream code, or package/lockfile changes were added.
The native ExpoProximity module and Electron helpers retain their existing
permission, scan, central/peripheral connection, write-queue, and event paths.
The new stopped-session bearer mode selects Bitchat UUIDs, notification semantics,
and raw packets. Native transport code does not parse chat or cryptography.

`src/services/bitchat/` owns the MIT-authored packet/TLV codec, bounded fragment
assembler, mesh/session engine, and account-scoped service. It reuses Outlink's
existing `@libp2p/noise` XX primitive and `@noble` X25519, Ed25519, SHA-256,
and ChaCha20-Poly1305 implementations. Bitchat-specific transport counters,
replay windows, signing bytes, and payload types are implemented here.
The separate Nearby Noise port retains its prologue and record protocol.

A standalone browser-target, minified Bitchat session bundle measured about
70 KiB, including its crypto dependencies. This is a reference measurement,
not the incremental size of an APK, IPA, or desktop installer; dependencies
shared with the app are deduplicated by its bundler.

## Ownership and teardown

The service takes an explicit temporary lease from `proximityService`.
The lease stops Nearby before selecting Bitchat and prevents foreground/retry
work from restarting Nearby while Bitchat owns the adapter. Releasing restores
the user's previous Nearby preference; it does not modify that preference.
Native mode changes require a stopped bearer. Old native binaries fail closed
when the new methods are unavailable.

Local seeds live in `platform.secureStorage` under
`bitchat.identity.<accountPubkey>`. Only non-secret public/session information
is exposed through the vanilla session store and React binding. Account removal
stops any matching Bitchat session and deletes its secure-storage entry.
In-memory seed copies and session keys are cleared on stop. The UI cannot
choose an arbitrary local account's secrets through the BLE adapter.

The protocol port's optional mode, MTU, and bounded raw-DEFLATE methods are
implemented by mobile adapters and all three desktop helpers. Electron IPC
validates sender, protocol enum, endpoint length, compressed input length, and
output size; decompression is limited before allocation. Handshake/session
objects are never routed through the Nostr event intake path.

## Validation and limitations

- Wire fixtures cover network byte order, v1/v2 routing/addressing, signature
  integrity across TTL changes, compression limits, malformed headers/padding,
  and fragment substitution/conflicts.
- Noise tests compare all three handshake messages and the first transport
  ciphertext against vectors generated independently using the repository's
  existing vendored Noise-C backend with an empty prologue. Fixed seeds are
  `01×32`, `02×32`, `03×32`, `04×32` for initiator static, responder static,
  initiator ephemeral, responder ephemeral. The fixture is
  `src/services/bitchat/__tests__/noise-c-vector.json`.
- Simulated three-node meshes cover discovery, cycle deduplication, multi-hop
  public text, relayed private messages, opaque intermediate traffic, receipts,
  signature rejection, byte limits, and bearer restoration.
- Screen tests cover separation of public/private timelines, intended private
  recipient selection, teardown, and both theme surfaces.
- The existing full test suite, type check, lint, main-process/renderer builds,
  and license catalog check accompany the feature. Linux and Windows helpers
  are compile-checked against their locked Rust dependency graphs.

Apple/Android SDK builds and physical Bluetooth tests are still required.
The macOS/iOS adapter source cannot be compiled on this Linux host, and an
Android toolchain is not installed. This implementation must not be described
as physically interoperable or release-ready until those checks pass.

Recommended device checks before release:

1. Rebuild the Expo modules and packaged desktop helpers. Install a fresh build.
2. Test Outlink ↔ Bitchat iOS and Outlink ↔ Bitchat Android discovery, Unicode
   public text, private messages in both directions, and delivered/read states.
3. Place a relay device between non-adjacent peers, verify public/private
   delivery and duplicate suppression, and repeat after a link reconnect.
4. Test MTU 185 and 512, Bluetooth-off/permission-denied behavior, account
   switching, room exit, and Nearby restoration without cross-protocol packets.
5. Confirm private ciphertext replay/tampering is rejected; compare fingerprints
   in person. Test backgrounding/navigation and relaunch with no retained chats.

Nostr/geohash channels, files/voice, couriers, public-history sync, persistent
remote trust pins, and advanced routing are separate work. The local MIT
license remains in place; existing third-party licenses/notices still apply.

### Checks performed for this change

The full suite passed **320 suites / 2,192 tests / four snapshots**. After a final
teardown/race hardening pass, the affected mesh and screen suites passed all
seven tests again. TypeScript and changed-file lint passed; repository lint has
zero errors and 154 existing warnings. Electron main and renderer builds and
the unchanged license catalog check passed. Locked Linux and Windows Rust
helper checks passed, including the Windows target compile check.
