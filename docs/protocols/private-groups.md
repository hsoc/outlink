# Private Bluetooth groups

## Using groups

Join **Nearby** first, then open **Private groups** beside Contacts. Choose a name
and **Create group**. Open **Members** to see the creator, full member fingerprints
and **On mesh / Mesh offline** status. Membership is persistent; a listed member
is not necessarily currently reachable. The roster authorizes participation; it
is not proof that an invitation was accepted or a key update delivered. Names
are labels, not unique identities.

The creator can invite reachable peers advertising group support. Inviting first
establishes a Noise-authenticated connection and confirms the signing identity.
Invitations appear in Private groups; inspect their roster, then **Accept
invitation** to participate, or **Leave group** to decline. These invitations do
not create OS notifications in this implementation. Existing public mention alerts
do not apply to group messages. The optional Android all-Nearby background setting
can alert for accepted messages in joined groups, with generic previews; viewing
the group suppresses alerts and clears its unread dot. See [notifications](mentions.md).

Only the creator manages membership. **Remove member** rotates the group key and
sends updates to remaining reachable members. Offline members receive updates
when they reconnect to the creator, including through intermediate mesh devices.
The removed member receives a signed removal notice containing a separate dummy
key, never the new group key. Removal cannot erase already-received history.

**Leave group** deletes the local group key and keeps a creator/epoch tombstone
against replay. It is local departure, not a signed membership change: the creator
must remove you to update the roster and revoke the old key. Rejoining requires
an explicit new invitation at a higher epoch (the creator can remove and invite
you again). If the creator leaves, remaining members can still use their existing
keys, but membership administration stops. There is no ownership transfer.

### Commands

Buttons provide the same actions without requiring command syntax.

| Command | Action |
| --- | --- |
| `/group create Trail team` | Create and open a group |
| `/group list` | Return to the group list |
| `/group members` | Show the selected group's roster |
| `/group invite @Alice` | Creator invites one unambiguously named reachable peer |
| `/group remove @Alice` | Creator removes a member and rotates the key |
| `/group leave` | Leave the selected group, with confirmation |

Create/list also work from the Nearby composer; the other commands require an
open group conversation. Displayed discriminated nicknames or full fingerprints resolve duplicate base nicknames; invitation
commands also accept a peer ID. `/join` and `/part` are not group commands: private
membership requires an authenticated invitation. A malformed `/group` command
fails locally and is never transmitted as chat text.

Group conversations use the shared bubbles and saved nickname, keep separate
encrypted drafts and history, and load older messages in pages within a 512-entry
loaded window. Saved group chat content expires after six hours; group membership
and keys are unaffected. Signed roster
nicknames are used for incoming display because the protocol does not include the
inner nickname in the sender signature. A roster nickname can therefore lag a
member's latest Settings nickname; authorship always uses the pinned signing key.
The creator has to distribute an updated signed roster to change that label.

## Limits and compatibility

There is no 16-member product cap. Outlink permits the protocol's entire one-byte
roster count: **255 members including the creator**. Official clients enforcing
16 reject larger rosters. This is an intentional compatibility difference, not
an extension that makes arbitrary-size groups interoperable. Larger groups cost
more radio time, battery and creator key-distribution work.

The original wire widths, authenticated creator authority, epoch exhaustion,
packet/fragment bounds, receive queues and anti-abuse controls remain necessary.
Pending unaccepted invitations have a 2 MiB aggregate metadata budget to prevent
an authenticated peer from allocating unlimited disk state. Joined groups have
no additional count policy. Text must fit the existing 16-bit fields (Outlink
allows up to 65,000 UTF-8 bytes before envelope overhead); actual sendable size
also depends on the link MTU and existing 256-fragment bound. Oversized sends fail
visibly. These safety/framing limits have not been represented as unlimited.

Group messages use encrypted fire-and-flood broadcasts with no per-member receipt
or guaranteed delivery. They never enter the public bridge, geohash relays,
private outbox or courier mail. Opaque gossip uses the existing 1,000-packet / 8 MiB
shared cache and six-hour group freshness window, so cache pressure can evict
messages sooner. Only the current epoch key is retained: rotating on invite or
removal prevents reading backfill from earlier epochs that was not already saved.
Offline members need the creator's current state before decrypting current traffic.
State pushes retry on authenticated reconnect and, while reachable, at most once
per minute per unchanged group/peer; radio transmission is not a state receipt.

## Wire and security invariants for implementers

This is an independently authored MIT implementation of the facts in
`bitchat/Services/Groups/GroupProtocol.swift` and `GroupStore.swift` at upstream
[`5e9287fae1e5fea80ca741d4ea669829dc16f144`](https://github.com/permissionlesstech/bitchat/tree/5e9287fae1e5fea80ca741d4ea669829dc16f144).
No implementation source is incorporated and no new dependencies are added.

- Capability bit 3 (`8`); broadcast packet type `0x25`; Noise control types
  `0x06` (invite) and `0x07` (key update/removal); gossip type bit 10.
- State TLV16 fields: ID[16], UTF-8 name, key[32], epoch[4 BE], roster, creator
  fingerprint[32], signature[64]. Roster: count[1], then fingerprint[32], signing
  key[32], nickname byte length[1], UTF-8 nickname (at most 64 bytes) per member.
- State signing bytes: `bitchat-group-v1 || ID || epochBE || SHA256(key) ||
  SHA256(roster) || SHA256(name)`. Verify the creator signature **and** the current
  Noise peer's full fingerprint/signing key. Existing creator identity is immutable.
- Message envelope TLV16: ID[16], epoch[4 BE], nonce[12], ciphertext+tag. Use
  ChaCha20-Poly1305 with AAD `ID || epochBE`. Inner TLV16: message ID, signing
  key[32], nickname, timestamp[8 BE milliseconds], content, signature[64].
- Inner signature: `bitchat-group-msg-v1 || ID || epochBE || messageID ||
  timestampBE || content`. Require signing-key membership in the pinned roster.
  Treat the unsigned inner nickname as untrusted display data. Duplicate required
  fields and ambiguous fingerprint/signing-key rosters are rejected; unknown TLVs
  are ignored. Group ID and epoch tampering fail authentication.
- State epochs never regress; same-epoch state cannot replace a key or remove or
  repin an existing member. Outlink rotates on additions as well as removals.
  New groups start at epoch one.
- Unknown validly framed group envelopes are relayed/cached opaquely, without
  disclosing them as public messages. Group backfill does not require an author's
  current announcement: the inner signature and roster authenticate authorship.
  On acceptance, key update and startup, replay eligible cache entries into the
  group handler. History IDs bind group, full sender fingerprint and message ID.

`GroupRuntime` serializes membership writes before publication, independently of
network waits. It persists keys, metadata, invitation decisions and revocation
retry metadata in authenticated encrypted protected records, under the existing
secure-store-held local-storage key; no group key enters UI state. This differs
from upstream's separate per-group keychain entries. Conversation history/drafts
use existing encrypted history/preferences. Clear history clears group messages,
but retains membership/keys and opaque gossip; later backfill can restore eligible
messages. Full identity wipe removes all these records and keys and resets group
UI state. Background behavior follows the existing Bluetooth lifecycle switch.

Group ID, outer sender ID, epoch, timing and sizes remain observable to relays.
Keys are symmetric and creator-managed; this is not MLS, has no post-compromise
security guarantee, and cannot protect against a malicious creator or compromised
member device. Old recipients' copies and platform backups cannot be remotely erased.

## Verification

Automated tests cover state/name signatures, framing, 255-member roster handling,
wrong key/epoch/group, sender membership, invitation acceptance and persistence,
creator takeover, key rotation and dummy-key removal, stale-state rollback,
leave/reinvitation, storage failures, command parsing, history clearing, multi-hop
Noise invitations, opaque nonmember relay, restart and group gossip backfill.
Native builds and interoperability with official applications on physical devices
remain unverified; physical testing was omitted by maintainer request.
