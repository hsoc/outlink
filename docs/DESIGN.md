# Outlink mobile design system

The existing visual language is retained for Android and iOS. Shared controls
live in `src/components/common`; numeric values and colours live in `src/theme`.

Keep the calm, content-first interface: restrained surfaces, ordinary language,
quiet chrome, and a single accent. Public channels and encrypted private chat
must be visibly distinguished. Do not imply that a location-channel participant
is physically nearby or that public messages are encrypted.

Use the shared AppScreen, ScreenHeader, AppText, AppInput, and AppButton primitives.
Respect safe areas, keyboard controls, accessibility labels, and logical start/end
layout. Reuse the original light/dark palettes, system appearance, accent choices,
frosted iOS chrome, opaque Android chrome, typography, spacing, and radii.

## Hard rules

1. No raw colours: use theme tokens.
2. No raw font metrics: use AppText variants and typography tokens.
3. No raw spacing: use the spacing scale.
4. Every route uses AppScreen and shared input/action components.
5. Do not add UI libraries without explicit authorization.
6. No per-screen theme; light and dark use the same semantic tokens.
7. Empty states include an icon, title, and useful guidance.
8. Only one primary action per screen; secondary/navigation actions stay quiet.
9. No decorative emoji in chrome.
10. Reuse existing controls and icon libraries before adding primitives.
11. Use logical direction and preserve readable RTL layouts.
12. Use plain language; keep technical detail in explicit area/relay controls.
13. Do not show empty states while initial preferences are unresolved.
14. No autofocus on pushed screens.
15. User-facing strings live in locale catalogs. New copy may fall back to
    English until translated; never leave a misleading retired-feature message.
16. Record durable design changes here, and implementation details in code/tests.

Verification QR codes use fixed, high-contrast paper and ink theme tokens in both appearances. Camera previews mount only during an explicit scan on the focused, foreground screen.

Internet bridging requires explicit consent. Mark public bridge messages clearly
and provide a nearby-only choice when composing a bridged message.

Private conversations opened from public channels show the full signed public key
and stay visibly separate from public channel messages and verified mesh contacts.

Active conversations give their message history the remaining scrollable space, while a compact composer remains accessible above the keyboard. Follow new messages only when the reader is near the latest; do not steal scroll position while they inspect older history. A disconnected session with saved history shows a reconnection action rather than overlapping setup and conversation surfaces. Transport status distinguishes Bluetooth peers, public relay links, and private mailbox links; transmission does not imply recipient delivery.

Identity changes preserve private conversation selection and drafts. Expired,
unconfirmed identity changes require a visible recovery action; never silently
present a new identity as authenticated continuity in another client.

Background connectivity is opt-in and visibly platform-limited. Its Android switch
explains battery use and requires a visible ongoing notification with a Stop
action. Public Mesh denotes Bluetooth broadcast; internet channels retain their
separate public-channel label.

A Public Mesh composer with no available peer or enabled bridge route labels its
disabled send button “Nobody Around”; available routes retain “Send”.

Saved mesh contacts remain selectable after disconnection, with explicit “On mesh”
or “Mesh offline” status. Retained identity/history must never imply live presence.

The mesh composer shows only Public Mesh and its selected private conversation;
a searchable Contacts menu separates live mesh presence, saved identities, and
recent history. Discovery alone must not imply an explicit permanent save.

Settings is the only nickname editor: **Public name / nickname**, with an explicit
Save action. Mesh and location setup show this same saved name with a Settings
link; joining never writes a second nickname value. New profiles receive
`Outlink` followed by four random digits (including leading zeros); the generated
name is persisted before use. Existing names are preserved. Editing the name does
not reconnect or replace communication identities, contacts, or history. Use the
shared input, secondary button, and an accessible save confirmation.

Location-area presets fill the editable code directly on tap; no separate location
button is needed. Explain the permission request before the presets are used.
Custom codes submit through Join or the keyboard, with inline validation. Public
name uses the same persisted random default as Nearby, never a fixed fallback.

The main header offers a small Outlink app icon as a quick-erase control. Three
activations within 1.5 seconds invoke the same full-data wipe immediately, without
confirmation. Partial sequences reset on blur or background; do not accumulate
taps across visits. Preserve an accessible hit target, describe the destructive
gesture to assistive technology and in Settings, hide conversations during the
operation, and distinguish completed erasure from a failure requiring retry.
