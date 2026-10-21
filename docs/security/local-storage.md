# Local encrypted storage

Messages, protected protocol records (contacts, outbox, and gossip), and private preferences (drafts, selected conversations/channels, relay
settings, and nickname) are encrypted before SQLite writes. Appearance preferences
remain ordinary local preferences. This is authenticated record encryption, not
SQLCipher or encryption of every SQLite page.

The existing MIT-compatible Noble libraries provide XChaCha20-Poly1305, HKDF-SHA256,
and HMAC-SHA256. A separate random 256-bit root key is saved in OS secure storage
under `outlink.local-storage.key.v1`, using the existing device-only accessibility
policy. It is independent of messaging identities. No password, external service,
or additional crypto dependency is introduced.

HKDF derives separate encryption and index keys. Every write uses a fresh random
192-bit nonce and a versioned envelope. AEAD associated data binds a message to
its keyed room/message indexes or a preference to its name. Copying ciphertext to
another record, changing its contents, or using the wrong key fails authentication.
Room names and message identifiers are keyed HMAC indexes; SQLite still reveals
record counts, insertion order, approximate lengths, and access patterns.

One lazy initialization promise owns the database and key for both history and
private preferences and protected records. Protected-record scope and ID indexes
are separately keyed, and their AEAD context binds both indexes. The authenticated key-check record prevents missing or
incorrect keys from silently replacing an existing encrypted store. Initialization
failures preserve data and propagate to the normal error UI. There is currently no
key recovery/export feature; a database restored without its device key cannot be
read. Clearing history does not rotate the storage or messaging keys.

## Upgrade from plaintext history

The existing mobile history database is upgraded in resumable transactions of at
most 100 rows, preserving sequence numbers and pagination. Each transaction
copies encrypted records before deleting the corresponding plaintext records.
The migration yields between batches; paged decryption also yields every 20 records. It must finish before exposing the store
or allowing new writes. A failed batch rolls back; completed batches remain
committed and the next attempt resumes from the remaining plaintext rows.

Legacy workspace/nickname preferences are copied to encrypted records before
removing their original preference values. Existing encrypted records take
precedence if cleanup was interrupted. Durable cleanup markers make compaction
retryable. The live history database and the installed Expo SQLiteStorage
preference database are compacted and their WAL files checkpointed after upgrade.

This does not guarantee forensic erasure on flash storage, old backups, snapshots,
or other copies. It does not import the retired pre-redesign messaging databases.

## Protection boundary and tests

The key is cached in the running process; this is not an application lock and
does not protect against a compromised/unlocked process, screenshots, recipients,
or plaintext public transmissions. Public geohash and mesh messages remain public
on their respective networks. Device protection and backup policy still matter.

Tests exercise round trips, fresh nonces, wrong keys, malformed versions, record
swapping/tampering, missing keys, failed key saves, interrupted/resumed migration,
pagination, reopen persistence, and absence of message/identifier plaintext in the
upgraded database. SQLite integration uses the actual adapter factory with Node's
SQLite driver; native keychain/keystore behavior has not been exercised on devices.


## Explicit identity erasure

The confirmed erasure action stops mesh/relay sessions, waits for pending work,
and invalidates foreground auto-resume before clearing messages, protected
protocol records and private preferences. It compacts/checkpoints the database,
deletes the old secure-storage encryption key and messaging identity root/seeds,
and resets application state. A later operation generates fresh keys. A failed
erasure remains disconnected and reports failure; it is not reported as success.
This does not promise deletion of flash remnants or backup/remote copies.

Additional integration tests cover encrypted protocol-record scope isolation,
bounded pagination, survival across chat deletion/reopen, rejection of lost keys
when only protocol records remain, and erasure followed by a fresh encryption key.

Private Bluetooth group epoch keys and roster/invitation/revocation metadata use
the authenticated encrypted protected-record store. Group conversations use
separate encrypted history rooms and workspace drafts. No group key is exposed
in UI stores. Full wipe removes them with the database/key; Clear history retains
membership and protocol gossip. See [private groups](../protocols/private-groups.md).
