import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function compiled(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, TextEncoder, TextDecoder, setTimeout, require: name => imports[name] ?? require(name) });
  return exports;
}
const retention = compiled('../src/lib/message-retention.ts');
const crypto = compiled('../src/lib/local-cipher.ts');
const { createEncryptedStorage } = compiled('../src/platform/expo/encrypted-storage.ts', { '@/lib/local-cipher': crypto, '@/lib/message-retention': retention });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'outlink-history-'));
  const keys = new Map(), legacyValues = new Map();
  const secrets = { async getItem(key) { return keys.get(key) ?? null; }, async setItem(key, value) { keys.set(key, value); }, async deleteItem(key) { keys.delete(key); } };
  const legacy = { async getItem(key) { return legacyValues.get(key) ?? null; }, async setItem(key, value) { legacyValues.set(key, value); }, async deleteItem(key) { legacyValues.delete(key); } };
  let clock = Date.now();
  let failSequence, failCompaction = false, compactions = 0;
  function open() {
    const connections = [];
    const storage = createEncryptedStorage(async () => {
      const db = new DatabaseSync(join(directory, 'history.db')); connections.push(db);
      const driver = {
        async execAsync(sql) { db.exec(sql); },
        async runAsync(sql, ...parameters) {
          if (sql.startsWith('INSERT INTO encrypted_messages(sequence') && parameters[0] === failSequence) {
            failSequence = undefined; throw new Error('simulated interruption');
          }
          return db.prepare(sql).run(...parameters);
        },
        async getAllAsync(sql, ...parameters) { return db.prepare(sql).all(...parameters); },
        async getFirstAsync(sql, ...parameters) { return db.prepare(sql).get(...parameters) ?? null; },
        async withExclusiveTransactionAsync(task) {
          db.exec('BEGIN IMMEDIATE');
          try { await task(driver); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
        },
        async closeAsync() { if (db.isOpen) db.close(); },
      };
      return driver;
    }, secrets, legacy, async () => {
      compactions++;
      if (failCompaction) { failCompaction = false; throw new Error('compaction interrupted'); }
    }, () => clock);
    return { ...storage, close() { connections.forEach(db => { if (db.isOpen) db.close(); }); } };
  }
  function raw(task) {
    const db = new DatabaseSync(join(directory, 'history.db'));
    try { return task(db); } finally { db.close(); }
  }
  return { open, raw, directory, keys, advance(ms) { clock += ms; }, now: () => clock, secrets, legacy, legacyValues, interruptAt(sequence) { failSequence = sequence; },
    interruptCompaction() { failCompaction = true; }, compactions: () => compactions,
    cleanup() { rmSync(directory, { recursive: true }); } };
}
test('encrypted history and drafts survive reopening, isolate channels, and do not persist plaintext identifiers/content', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.history.save('geo:private-channel', 'private-message-id', '{"content":"secret transcript","delivery":"sending"}');
    await adapter.history.save('geo:other-channel', 'private-message-id', '{"content":"other transcript"}');
    await adapter.history.save('geo:private-channel', 'private-message-id', '{"content":"secret transcript","delivery":"read"}');
    await adapter.preferences.setItem('mobile.workspace', '{"drafts":{"private":"unsent private draft"}}');
    adapter.close(); adapter = f.open();
    const messages = await adapter.history.load('geo:private-channel');
    assert.equal(messages.length, 1); assert.equal(JSON.parse(messages[0].value).delivery, 'read');
    assert.equal(JSON.parse((await adapter.history.load('geo:other-channel'))[0].value).content, 'other transcript');
    assert.match(await adapter.preferences.getItem('mobile.workspace'), /unsent private draft/);
    const bytes = readFileSync(join(f.directory, 'history.db'));
    for (const text of ['secret transcript', 'unsent private draft', 'private-channel', 'private-message-id']) assert.equal(bytes.includes(Buffer.from(text)), false);
    await adapter.history.clear(); adapter.close(); adapter = f.open();
    assert.equal((await adapter.history.load('geo:private-channel')).length, 0);
    assert.equal((await adapter.history.load('geo:other-channel')).length, 0);
  } finally { adapter.close(); f.cleanup(); }
});
test('encrypted pagination remains bounded, ordered and without overlapping pages', async () => {
  const f = fixture(), adapter = f.open();
  try {
    for (let i = 0; i < 451; ++i) await adapter.history.save('mesh', String(i), JSON.stringify({ id: i }));
    const newest = await adapter.history.load('mesh');
    const older = await adapter.history.load('mesh', newest[0].sequence);
    const oldest = await adapter.history.load('mesh', older[0].sequence);
    assert.equal(newest.length, 200); assert.equal(older.length, 200); assert.equal(oldest.length, 51);
    assert.equal(new Set([...oldest, ...older, ...newest].map(row => row.sequence)).size, 451);
    assert.equal(JSON.parse(newest.at(-1).value).id, 450); assert.equal(JSON.parse(oldest[0].value).id, 0);
  } finally { adapter.close(); f.cleanup(); }
});
test('plaintext migration resumes after a rolled-back batch, preserves sequences and scrubs the live database', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    f.raw(db => {
      db.exec('CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, id TEXT, value TEXT)');
      const insert = db.prepare('INSERT INTO messages(sequence, room, id, value) VALUES (?, ?, ?, ?)');
      for (let i = 1; i <= 251; ++i) insert.run(i, 'geo:old-private-area', String(i), JSON.stringify({ content: 'old plaintext secret', id: i }));
    });
    f.legacyValues.set('mobile.workspace', '{"drafts":{"mesh:public":"old draft"}}');
    f.legacyValues.set('mobile.nickname', 'old nickname');
    f.interruptAt(150);
    await assert.rejects(adapter.history.load('geo:old-private-area'), /simulated interruption/);
    f.raw(db => {
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 151);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM encrypted_messages').get().count, 100);
    });
    adapter.close(); adapter = f.open();
    const newest = await adapter.history.load('geo:old-private-area');
    assert.equal(newest[0].sequence, 52); assert.equal(newest.at(-1).sequence, 251);
    assert.equal((await adapter.history.load('geo:old-private-area', 52)).length, 51);
    assert.match(await adapter.preferences.getItem('mobile.workspace'), /old draft/);
    assert.equal(await adapter.preferences.getItem('mobile.nickname'), 'old nickname');
    assert.equal(f.legacyValues.size, 0);
    f.raw(db => assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'messages'").get(), undefined));
    adapter.close();
    const bytes = readFileSync(join(f.directory, 'history.db'));
    assert.equal(bytes.includes(Buffer.from('old plaintext secret')), false);
    assert.equal(bytes.includes(Buffer.from('old-private-area')), false);
  } finally { adapter.close(); f.cleanup(); }
});
test('missing or incorrect keys fail closed without replacing the key or changing ciphertext', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.history.save('mesh', 'id', 'protected message'); adapter.close();
    const saved = f.raw(db => db.prepare('SELECT value FROM encrypted_messages').get().value);
    f.keys.clear(); adapter = f.open();
    await assert.rejects(adapter.history.load('mesh'), /key is unavailable/);
    assert.equal(f.keys.size, 0);
    f.keys.set('outlink.local-storage.key.v1', 'ab'.repeat(32));
    await assert.rejects(adapter.history.load('mesh'));
    assert.equal(f.raw(db => db.prepare('SELECT value FROM encrypted_messages').get().value), saved);
  } finally { adapter.close(); f.cleanup(); }
});
test('tampering and moving ciphertext to another row are rejected', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.history.save('mesh', 'a', 'first'); await adapter.history.save('mesh', 'b', 'second');
    adapter.close();
    f.raw(db => {
      const [a, b] = db.prepare('SELECT sequence, value FROM encrypted_messages ORDER BY sequence').all();
      db.prepare('UPDATE encrypted_messages SET value = ? WHERE sequence = ?').run(a.value, b.sequence);
    });
    adapter = f.open(); await assert.rejects(adapter.history.load('mesh'));
  } finally { adapter.close(); f.cleanup(); }
});
test('a failed key save never writes encrypted user data or discards legacy data', async () => {
  const f = fixture(); const original = f.secrets.setItem;
  f.secrets.setItem = async () => { throw new Error('keychain unavailable'); };
  f.legacyValues.set('mobile.workspace', 'legacy draft');
  const adapter = f.open();
  try {
    await assert.rejects(adapter.history.save('mesh', 'id', 'message'), /keychain unavailable/);
    assert.equal(f.raw(db => db.prepare('SELECT COUNT(*) AS count FROM encrypted_messages').get().count), 0);
    assert.equal(f.legacyValues.get('mobile.workspace'), 'legacy draft');
    f.secrets.setItem = original;
    await adapter.history.save('mesh', 'id', 'message');
    assert.equal((await adapter.history.load('mesh'))[0].value, 'message');
  } finally { adapter.close(); f.cleanup(); }
});

test('interrupted preference cleanup resumes without replacing encrypted values with stale plaintext', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    f.legacyValues.set('mobile.workspace', 'original draft');
    f.interruptCompaction();
    await assert.rejects(adapter.preferences.getItem('mobile.workspace'), /compaction interrupted/);
    assert.equal(f.legacyValues.size, 0);
    adapter.close();
    f.legacyValues.set('mobile.workspace', 'stale restored draft');
    adapter = f.open();
    assert.equal(await adapter.preferences.getItem('mobile.workspace'), 'original draft');
    assert.equal(f.compactions(), 2); assert.equal(f.keys.size, 1); assert.equal(f.legacyValues.size, 0);
    f.raw(db => assert.equal(db.prepare("SELECT name FROM local_meta WHERE name = 'preferences-cleanup'").get(), undefined));
  } finally { adapter.close(); f.cleanup(); }
});

test('protocol records are encrypted, scope-isolated, paginated and independent of chat deletion', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.records.set('contacts', 'secret-contact', 'private-contact-record');
    await adapter.records.set('outbox', 'secret-contact', 'private-outbox-record');
    await adapter.history.save('mesh', 'one', 'private-transcript');
    assert.equal(await adapter.history.get('mesh', 'one'), 'private-transcript');
    await adapter.history.clear();
    assert.equal(await adapter.history.get('mesh', 'one'), null);
    assert.equal(await adapter.records.get('contacts', 'secret-contact'), 'private-contact-record');
    assert.equal(await adapter.records.get('outbox', 'secret-contact'), 'private-outbox-record');
    for (let i = 0; i < 205; ++i) await adapter.records.set('gossip', String(i), String(i));
    const page = await adapter.records.list('gossip');
    assert.equal(page.length, 200); assert.equal((await adapter.records.list('gossip', page.at(-1).sequence)).length, 5);
    adapter.close(); adapter = f.open();
    assert.equal(await adapter.records.get('contacts', 'secret-contact'), 'private-contact-record');
    const bytes = readFileSync(join(f.directory, 'history.db'));
    for (const text of ['secret-contact', 'private-contact-record', 'private-outbox-record']) assert.equal(bytes.includes(Buffer.from(text)), false);
    await adapter.records.clear('contacts'); assert.equal(await adapter.records.get('contacts', 'secret-contact'), null);
    assert.equal(await adapter.records.get('outbox', 'secret-contact'), 'private-outbox-record');
  } finally { adapter.close(); f.cleanup(); }
});
test('identity wipe deletes histories, protected records, preferences and the old encryption key', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.history.save('mesh', 'one', 'old transcript');
    await adapter.records.set('contacts', 'one', 'old contact');
    await adapter.preferences.setItem('mobile.workspace', 'old drafts');
    const oldKeys = [...f.keys.values()]; assert.equal(oldKeys.length, 1);
    await adapter.wipe(); assert.equal(f.keys.size, 0);
    adapter.close(); adapter = f.open();
    assert.equal((await adapter.history.load('mesh')).length, 0);
    assert.equal((await adapter.records.list('contacts')).length, 0);
    assert.equal(await adapter.preferences.getItem('mobile.workspace'), null);
    assert.notDeepEqual([...f.keys.values()], oldKeys);
  } finally { adapter.close(); f.cleanup(); }
});
test('protected protocol records prevent silent key regeneration after secure storage loss', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.records.set('contacts', 'one', 'identity pin'); adapter.close(); f.keys.clear(); adapter = f.open();
    await assert.rejects(adapter.records.list('contacts'), /key/i); assert.equal(f.keys.size, 0);
  } finally { adapter.close(); f.cleanup(); }
});
test('conversation deletion erases all private pages, preserves other rooms, and blocks replay/status resurrection', async () => {
  const f = fixture(); let adapter = f.open();
  const privateMessage = (id, overrides = {}) => JSON.stringify({ id, peer: 'alice', recipient: 'bob', outgoing: true, content: 'private transcript', delivery: 'sent', ...overrides });
  try {
    for (let index = 0; index < 205; index++) await adapter.history.save('mesh', 'sent-' + index, privateMessage('sent-' + index));
    await adapter.history.save('mesh', 'received', privateMessage('received', { peer: 'bob', recipient: 'alice', outgoing: false, delivery: 'read' }));
    await adapter.history.save('mesh', 'public', privateMessage('public', { peer: 'bob', recipient: undefined, outgoing: false }));
    await adapter.history.save('mesh', 'other', privateMessage('other', { recipient: 'carol' }));
    await adapter.history.save('geo-private:area', 'location', privateMessage('location'));
    await adapter.records.set('contacts', 'bob', 'preserved contact settings');
    await adapter.history.deleteConversation('mesh', 'bob', ['pending-only']);
    assert.deepEqual([...await adapter.history.load('mesh')].map(row => JSON.parse(row.value).id), ['public', 'other']);
    assert.deepEqual(JSON.parse(await adapter.history.get('mesh', 'received')), { deleted: true, delivery: 'read' });
    assert.equal(JSON.parse(await adapter.history.get('mesh', 'pending-only')).deleted, true);
    await adapter.history.save('mesh', 'sent-0', privateMessage('sent-0', { delivery: 'read' }));
    assert.equal(JSON.parse(await adapter.history.get('mesh', 'sent-0')).deleted, true);
    adapter.close(); adapter = f.open();
    assert.equal((await adapter.history.load('mesh')).length, 2);
    assert.equal((await adapter.history.load('geo-private:area')).length, 1);
    assert.equal(await adapter.records.get('contacts', 'bob'), 'preserved contact settings');
    await adapter.history.save('mesh', 'new-dm', privateMessage('new-dm'));
    assert.equal((await adapter.history.load('mesh')).length, 3);
  } finally { adapter.close(); f.cleanup(); }
});
test('existing encrypted history gains replay markers without changing old message encryption', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.history.save('mesh', 'old', JSON.stringify({ peer: 'bob', recipient: 'me', outgoing: false, content: 'old private', delivery: 'delivered' }));
    adapter.close();
    const raw = new DatabaseSync(join(f.directory, 'history.db'));
    raw.exec('DROP INDEX encrypted_visible_sequence; ALTER TABLE encrypted_messages DROP COLUMN deleted'); raw.close();
    adapter = f.open();
    assert.equal((await adapter.history.load('mesh')).length, 1);
    await adapter.history.deleteConversation('mesh', 'bob');
    assert.equal((await adapter.history.load('mesh')).length, 0);
    assert.equal(JSON.parse(await adapter.history.get('mesh', 'old')).deleted, true);
  } finally { adapter.close(); f.cleanup(); }
});
test('conversation deletion rolls back content erasure if any encrypted row is corrupt', async () => {
  const f = fixture(), adapter = f.open();
  try {
    const value = JSON.stringify({ peer: 'bob', recipient: 'me', outgoing: false, content: 'keep on failure' });
    await adapter.history.save('mesh', 'corrupt', value); await adapter.history.save('mesh', 'healthy', value);
    const raw = new DatabaseSync(join(f.directory, 'history.db'));
    raw.exec("UPDATE encrypted_messages SET value = 'corrupt' WHERE sequence = 1"); raw.close();
    await assert.rejects(adapter.history.deleteConversation('mesh', 'bob'), /format/i);
    assert.equal(JSON.parse(await adapter.history.get('mesh', 'healthy')).content, 'keep on failure');
  } finally { adapter.close(); f.cleanup(); }
});

test('six-hour expiry removes content without touching Cashu, outbox or contacts and status updates cannot extend it', async () => {
  const f = fixture(); const adapter = f.open();
  try {
    const timestamp = f.now();
    await adapter.history.save('mesh', 'old', JSON.stringify({ timestamp, content: 'expire me', delivery: 'sent' }));
    for (const scope of ['cashu-transfers', 'outbox:peer', 'contacts']) await adapter.records.set(scope, 'protected', 'keep me');
    f.advance(5 * 60 * 60 * 1000);
    await adapter.history.save('mesh', 'old', JSON.stringify({ timestamp: f.now(), content: 'status update', delivery: 'read' }));
    assert.equal((await adapter.history.load('mesh')).length, 1);
    f.advance(60 * 60 * 1000);
    assert.equal((await adapter.history.load('mesh')).length, 0);
    assert.equal(await adapter.history.get('mesh', 'old'), null);
    await adapter.history.prune();
    assert.equal(f.raw(db => db.prepare('SELECT count(*) AS n FROM encrypted_messages').get().n), 0);
    for (const scope of ['cashu-transfers', 'outbox:peer', 'contacts']) assert.equal(await adapter.records.get(scope, 'protected'), 'keep me');
    await adapter.history.save('mesh', 'old', JSON.stringify({ timestamp, content: 'late replay' }));
    assert.equal((await adapter.history.load('mesh')).length, 0);
  } finally { adapter.close(); f.cleanup(); }
});

test('expiry migration assigns existing encrypted rows a deadline and does not reset it on reopen', async () => {
  const f = fixture(); let adapter = f.open();
  try {
    await adapter.history.save('geo:area', 'retained', JSON.stringify({ timestamp: f.now(), content: 'existing' }));
    f.raw(db => db.exec('UPDATE encrypted_messages SET expires_at = NULL'));
    adapter.close(); f.advance(5 * 60 * 60 * 1000); adapter = f.open();
    assert.equal((await adapter.history.load('geo:area')).length, 1);
    adapter.close(); f.advance(60 * 60 * 1000); adapter = f.open();
    assert.equal((await adapter.history.load('geo:area')).length, 0);
    await adapter.history.prune();
    assert.equal(f.raw(db => db.prepare('SELECT count(*) AS n FROM encrypted_messages').get().n), 0);
  } finally { adapter.close(); f.cleanup(); }
});
