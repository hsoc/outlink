# Prepared Cashu token transfers

Outlink can move existing Cashu tokens between two Outlink Android/iOS clients
through Nearby encrypted private messages. Funding, denomination selection, change,
mint trust, proof validation and redemption belong to an external Cashu wallet.
This is not a wallet balance or a promise of offline settlement.

## User flow

1. In a trusted Cashu wallet, prepare a token for the exact amount to transfer.
   Keep a secure recovery copy until the recipient redeems it. Do not spend or
   send that copy elsewhere; the recipient bears double-spend risk until redemption.
2. Join Nearby on both phones, open the intended person's private conversation,
   and compare their fingerprint. Choose **Cashu transfers**.
3. Paste a `cashuA` or `cashuB` token, choose **Review token**, check its mint,
   stated amount and recipient identity, then confirm **Send token via Bluetooth**.
4. The other person opens **Cashu transfers** in that conversation, or from
   Settings. Partial transfers show their received-part count. Complete transfers
   show **Received — unverified**. Choose **Copy token to external wallet**, then
   paste and redeem in a trusted wallet when connected.
5. Only that external wallet can report redemption. Outlink never changes a
   transfer to Paid/Redeemed and never contacts the token's mint.

Sending reports a transmission attempt, not recipient persistence or mint
settlement. On interruption, use **Retry same recipient**. Retries resend the
same prepared token, with fresh message IDs so a previous failed receiver write
can be retried within the same Bluetooth session. Never refund or reassign an
uncertain transfer automatically. The outgoing token can also be copied for
manual recovery, with an explicit bearer-money warning.

## Scope and limits

Single-mint, sat-denominated tokens only: at most 32 proofs and 8192 ASCII token
characters. HTTPS mint URLs only, with no credentials, query or fragment. Tokens
are inspected using pinned `@cashu/cashu-ts` 4.13.0 (MIT license option); structural
checks and valid curve points do not authenticate the mint or its signatures.
Short V4 keyset IDs are retained unchanged; the external redeeming wallet must
resolve them. Unknown units, multi-mint V3 envelopes, excessive amounts, duplicate
proof secrets, malformed tokens and oversized inputs are rejected before sending.
Original token bytes (apart from URI/padding normalization) are preserved. Outlink
cannot split proofs, create change, mint, swap, check spent state or melt tokens.

Both phones need this Outlink feature. `OLC1` is an Outlink application framing
convention, not a Cashu NUT or an upstream Bitchat payment feature. Other Bitchat
clients may display the encrypted-DM frames as text but do not assemble transfers.
There is no QR scanner, payment notification, internet/courier fallback, automatic
retry, deletion control or automatic redemption in this first implementation.

## Transport and storage invariants

Each frame is `OLC1:<SHA256(token)>:<zero-based-index>:<part-count>:<data>`.
The data chunk is at most 176 ASCII characters, keeping frames under the existing
255-byte private-message limit. There are at most 47 frames per token. Ordinary
Noise DMs and mesh routing/fragmentation carry them; public chat, groups, bridges,
relay mail and courier outboxes are never used by the transfer sender. Cashu
frames are accepted only from incoming Noise private-message callbacks after
existing sender block checks. They never become chat-history rows, mention events
or generic DM alerts. Transport receipts are not payment receipts.

Records bind sender/recipient, direction, token digest and part count. Persistent
assembly tolerates reordered and duplicate parts; conflicting parts or a wrong
completed digest are rejected. Writes are serialized, finish before UI publication,
and use existing authenticated encrypted protected-record storage. Quotas cap
storage at 128 incoming/outgoing transfers, including partial transfers, with no
automatic eviction of money. A full store requires manual recovery and full erasure
before more transfers; do not use this initial version for high-volume receiving.
Metadata-only UI state excludes tokens and proof secrets. Outgoing proof-secret
fingerprints prevent accidental local reassignment, including overlapping proofs
in differently encoded tokens; this cannot stop spending from another wallet.

Clear history and Delete conversation preserve payment records. Full erasure,
including the immediate triple-tap shortcut, cancels/drains payment writes, removes
all token records and clears their UI metadata. It cannot recall tokens from peers,
erase clipboard copies or recover funds without an external recovery copy.
Clipboard export requires confirmation and uses the existing native port.
No sender nicknames, token memo, mint URLs or token contents trigger network calls.

Automated tests cover token formats, bounds, invalid proofs, sender scoping,
reordering/conflicts/retries, overlap checks, storage failures, erasure races and
Bluetooth-only service integration. Physical-device interoperability and real-fund
mint redemption have not been tested.
