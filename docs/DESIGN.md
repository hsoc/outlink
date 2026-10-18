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
