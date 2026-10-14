# Outlink privacy and network behavior

This document describes the client in this repository. It does not describe a
hosted Outlink service: no official website, username service, or internet push
backend is configured. Source code and project information are published at
https://github.com/hsoc/outlink.

## Identity and contacts

Accounts use cryptographic keys. Creating an account does not require a phone
number, email address, or registered username. QR codes and public-key sharing
let people exchange contact details. Looking up a complete external personal
identifier contacts the domain named in that identifier. Bare nicknames do not
contact a built-in naming provider.

## Network services

Internet messaging contacts configured Nostr relays. Relays and other network
providers can observe connection addresses, timing, and routing information even
when message content is encrypted. Public profile information is public.
Attachment uploads and downloads contact the selected file servers; treat any
publicly shared content and URLs as potentially accessible to others.

Nearby and Bitchat modes use Bluetooth. Nearby devices can observe discovery
traffic and public broadcast messages. Private-message encryption does not hide
all radio activity or prove a person's real-world identity.

Internet push notifications are disabled and their iOS controls are hidden.
The app does not acquire new push tokens or register devices for internet push.
An upgraded installation may contact previously registered services to revoke
old registrations. Android and desktop local notifications remain available.

## Device data and exports

The client stores account settings, contacts, and message history locally and
uses platform storage for private signing material. Protect the device and its
backups. Exported keys, chat archives, and shared files may contain sensitive
information; share and store them accordingly.

Removing a local account or message does not guarantee removal of copies held
by recipients, relays, file servers, or backups. Review configured services and
their policies before using them. Implementation details are in
[ARCHITECTURE.md](ARCHITECTURE.md) and [protocols/](protocols/).
