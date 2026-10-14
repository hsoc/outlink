# Outlink application identity

The maintained application is Outlink, hosted at https://github.com/hsoc/outlink.
Production uses `io.github.hsoc.outlink`, the `outlink` URL scheme, and the
`outlink-desktop` package. Development uses the `.dev` application ID,
`outlink-dev` scheme, and `outlink-desktop-dev` package.

The rename covers display names, translations, native package directories and
JNI symbols, App Group keys, notification extension names, desktop IPC/file
schemes, helper executables, C wrapper symbols, local storage namespaces,
backup format names, and personal-configuration event identifiers. The existing
brand mark is retained with renamed asset files. Original copyright and
third-party license texts remain intact.

## Compatibility

This is a separate application identity, not an in-place upgrade of the upstream
application. OS sandboxes, credentials, permissions, and local settings do not
migrate automatically. Keep the original installation and back up keys and
history before switching. Nostr identity keys remain portable. Archive format
names and application-specific configuration events now belong to Outlink;
archives and configuration from the upstream application are not automatically
converted. Do not assume a key backup alone restores complete chat history.

The native Nearby Noise prologue and signed binding label use the Outlink name.
All participating Outlink peers must use the renamed implementation. The native
C fixture is checked against an independent JavaScript Noise implementation.
The standard Bitchat service identifiers and Noise protocol are unchanged by
this application rename.

## Services and distribution

No new service domain is assumed. Website and privacy links point to the
repository and its privacy documentation. The upstream relay was removed from
new-account defaults. Dormant registration and disabled push implementations use
reserved `.invalid` placeholders. They require real service configuration and
review before being enabled; the repository is not a naming or push server.
Existing user-saved relay lists are not rewritten.

Desktop updates and release links point to `hsoc/outlink`. Configure signing
credentials for the new native application IDs before distribution. Set
`APPLE_TEAM_ID` for iOS builds; no upstream team is selected by default. The F-Droid
recipe remains disabled and contains no inherited signing certificate. Zapstore
publishing requires the maintainer's own publishing identity. Screenshots with
the upstream title were removed and must be recaptured from verified Outlink
builds before store submission.

This change does not rewrite Git history or publish signed application binaries.
