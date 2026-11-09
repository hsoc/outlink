# Outlink mobile design system

The existing visual language is retained for Android and iOS. Shared controls
live in `src/components/common`; numeric values and colours live in `src/theme`.

Keep the calm, content-first interface: restrained surfaces, ordinary language,
quiet chrome, and a single accent. Public channels and encrypted private chat
must be visibly distinguished. Do not imply that a location-channel participant
is physically nearby or that public messages are encrypted.

Use the shared AppScreen, ScreenHeader, AppText, AppInput, and AppButton primitives.
Respect safe areas, keyboard controls, accessibility labels, and logical start/end
layout. Android system bars use the Expo edge-to-edge window and safe-area
insets. Screen-level StatusBar controls set icon style without deprecated
background-color or translucency props. Reuse the original light/dark palettes,
system appearance, accent choices,
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

Active conversations give their message history the remaining scrollable space, while a compact composer remains accessible above the keyboard. Follow incoming messages when the reader is near the latest; do not steal scroll position while they inspect older history. Sending returns to the latest message. Only deliberate scrolling changes follow intent; content growth and keyboard resizing must not turn it off. A disconnected session with saved history shows a reconnection action rather than overlapping setup and conversation surfaces. Transport status distinguishes Bluetooth peers, public relay links, and private mailbox links; transmission does not imply recipient delivery.

Identity changes preserve private conversation selection and drafts. Expired,
unconfirmed identity changes require a visible recovery action; never silently
present a new identity as authenticated continuity in another client.

Background connectivity is opt-in and visibly platform-limited. Its Android switch
explains battery use and requires a visible ongoing notification with a Stop
action. The switch applies to joined Nearby or Location messaging independently;
notification copy must remain accurate for either transport. Public Mesh denotes Bluetooth broadcast; internet channels use their area-code selector and retain public-channel context
for accessibility.

A Public Mesh composer with no available peer or enabled bridge route labels its
disabled send button “Nobody Around”; available routes retain “Send”.

Saved mesh contacts remain selectable after disconnection, with explicit “On mesh”
or “Mesh offline” status. Retained identity/history must never imply live presence.

The mesh composer shows only Public Mesh and its selected private conversation;
a searchable Contacts menu separates live mesh presence, saved identities, and
recent history. Discovery alone must not imply an explicit permanent save.

Settings is the only nickname editor: **Nickname**, with an explicit Save action,
pending feedback and accessible confirmation. Every other normal screen shows
`@` plus the saved base beside the app icon in its top bar; tapping the name opens
Settings. Pushed screens reserve an identity row under the title row to avoid
navigation overlap. Root chrome keeps the quick-erase icon; pushed-page icons are
decorative and never acquire that destructive gesture. Setup bodies do not repeat
the nickname. New profiles use base `Outlink`; other users' labels add a four-hex
identity discriminator only for duplicate active nicknames. Keep full fingerprints for trust and never add stable
cross-channel identity metadata. Editing does not reconnect or replace keys,
contacts or history. Long header labels truncate within the available width.

Location-area presets fill the editable code directly on tap; no separate location
button is needed. Explain the permission request before the presets are used.
Custom codes submit through Join or the keyboard, with inline validation. The
shared top-bar nickname replaces duplicate name fields in both setup modes.

The main header offers a small Outlink app icon as a quick-erase control. Three
activations within 1.5 seconds invoke the same full-data wipe immediately, without
confirmation. Partial sequences reset on blur or background; do not accumulate
taps across visits. Preserve an accessible hit target, describe the destructive
gesture to assistive technology and in Settings, hide conversations during the
operation, and distinguish completed erasure from a failure requiring retry.

Conversation messages use content-sized rounded bubbles, capped below the full
row width. Outgoing bubbles align to the logical end with the accent-soft fill;
incoming bubbles align to the start with the elevated surface. A smaller lower
corner points toward the sender side. Provide Copy message through the long-press menu in all conversations; retain
selectable sender/key labels, bridge attribution, private-message actions, and delivery status. Use the
same treatment for mesh and location conversations in both themes and RTL.

Location presets cover Region through Block and include approximate grid widths,
explicitly distinguished from radio range. Derive the six-character bridge area
from the same location fix, fill it only when empty, and preserve custom or active
bridge choices. Choosing an area or relay policy never enables bridging.

Joined location channels show an explicit Active recently count and explain its
three-minute window, inclusion of self, and identity-based estimate in the Info
panel beside Location channels. Keep the count and a short public/private label
visible; move public relay/privacy and daily-identity explanations into that panel.
Retain the initial join privacy notice and actionable private identity warnings. Disconnected
relays show unavailable rather than implying zero users or live presence.

Tapping received message text inserts a plain-text sender mention into the current
draft and focuses the composer, without sending. In every conversation, including
private Bluetooth groups, press-and-hold opens message actions instead of native
text selection.
Public chat sender names provide the same shortcut. Mentions of
the saved shared nickname receive an accent bubble outline and a text label,
independent of OS permissions. Local mention notifications are explicitly opt-in
in Settings and use generic previews without names, text or area codes. Explain
that a live connection is required and that this does not add remote push.

Private Bluetooth groups have a separate group list and conversation, using shared
bubbles and controls. Offer buttons alongside `/group` commands, explicit invitation
acceptance, creator management, and full member fingerprints. Keep roster membership
separate from live reachability. Distinguish encrypted group broadcasts from public
mesh and 1:1 receipt semantics; explain local leave and creator departure.

Received Nearby and Location-channel DMs use the same horizontal public/DM selector.
Show the selected DM and unread sender buttons beside Public Mesh or `#area`, with
red dots and unread counts, independent of OS permission. Bound and truncate long
selector labels so one nickname cannot dominate the horizontal row. Keep the selected button
after reading. Other-mode unread DMs light that mode’s tab. Nearby Contacts and
its contact rows also show unread dots; Location recent threads remain area-scoped.
Sender shortcuts open the private thread directly. Only the visible foreground conversation marks messages read. Optional
Private-message notifications are separate from public mention alerts and
use generic previews without names or content.

Conversation message text opens a compact action sheet on long-press:
Copy message, Message user, Hug user, Slap user, and Block user. Own messages offer
Copy only. A normal tap still mentions the sender; a long-press must not also add
a mention. Replace per-message private-message buttons with Message user. Actions
post to the pressed conversation without overwriting drafts. Message user opens
the private composer regardless of route readiness; show rediscovery guidance or
an explicit internet enable/reconnect action there. Opening a thread must not
silently enable internet messaging. Hug and slap require an available send route. Persistent identity blocks hide received messages and suppress
alerts, with an unblock control in Settings. No decorative emoji is added to the
menu; hug/slap emoji belong to the posted message content. All action-sheet
rows, including Cancel, use matching full-width framed button heights and centered
labels; ordinary actions use neutral secondary styling and Block keeps its danger
styling.

Private group invites show the recipient’s full fingerprint in a confirmation
before granting membership.

Contact cards keep per-person conversation management alongside contact actions.
Delete conversation is a distinct destructive action at the end, with a
confirmation describing local deletion, draft clearing and queued-send cancellation.
It preserves contact identity/trust settings and does not imply remote deletion.

Location conversations use one area button labeled only `#area`. From a private
conversation it returns to public chat; from public chat it opens the area controls.
Back in a Nearby or Location DM closes only that view and preserves the joined
mesh or public area channel. Offer Leave only in the public view; omit the separate area label and Change area button. Its
accessibility label retains public-channel context to distinguish broadcasts
from private threads.

Nearby attachments show sender, type and size before acceptance. Keep public
visibility explicit and leave media unopened until the recipient accepts it.
Live Nearby voice uses an explicit listening toggle and a hold-to-talk control.
Keep Send and compact, accessibility-labelled media actions on one row, with
Send using the remaining width. Stop capture and playback when the active
conversation loses focus. While capturing audio, replace the composer visually with
a compact waveform or transmission activity display and elapsed time. Preserve
the draft and composer geometry; respect reduced-motion preferences.

Cashu transfers are explicit actions inside Nearby private conversations, with a
Settings entry for received/recovery records. Review shows the stated amount, mint
and recipient identity before sending. Never label offline tokens Paid or Redeemed.
Keep token secrets out of chat bubbles; copying bearer money requires confirmation.
Explain external redemption, double-spend risk and full-erasure loss before use.

System alerts stay silent for the focused foreground conversation. Red unread dots
sit at the logical top end of Nearby, Location, public/area, DM and group controls,
use the notification theme token, and remain independent of OS permissions. Viewing
a conversation clears its activity indicator. Android's optional all-Nearby alerts
are subordinate to active background connectivity; Appearance follows these settings.

Message bubble headers show the sender nickname followed by `[HH:mm:ss]`, using
24-hour device-local time from the original message timestamp. Keep timestamps
out of mention text and message-copy content; they describe message time, not delivery.
Apply this consistently to Nearby, Location public/private chats and Bluetooth groups.

App branding uses the maintainer-approved supplied blue chat-bubble artwork,
including its original white “bitchat” lettering and white canvas. Preserve the
artwork when generating platform sizes. Use a white launch-screen background and
keep the complete mark within Android adaptive-icon masks; do not retain a retired
monochrome symbol. The header and quick-erase control share the configured app icon.

Conversation operation errors have an explicit Dismiss control. Show background
transport errors only in their corresponding Nearby or Location view. Dismissing
a notice acknowledges it without deleting data or changing the connection;
subsequent failures can appear again. Keep storage failure warnings separate.
