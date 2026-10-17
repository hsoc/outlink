import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/platform/expo/history.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function open(directory) {
  const connections = [];
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    assert.equal(name, 'expo-sqlite');
    return { async openDatabaseAsync(filename) {
      const db = new DatabaseSync(join(directory, filename)); connections.push(db);
      return {
        async execAsync(sql) { db.exec(sql); },
        async runAsync(sql, ...parameters) { return db.prepare(sql).run(...parameters); },
        async getAllAsync(sql, ...parameters) { return db.prepare(sql).all(...parameters); },
      };
    } };
  } });
  return { history: exports.historyAdapter, close() { connections.forEach(db => db.close()); } };
}
test('history survives adapter/process recreation, isolates channels, and updates without duplicating', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'outlink-history-'));
  let adapter = open(directory);
  try {
    await adapter.history.save('mesh', 'a', '{"content":"private","delivery":"sending"}');
    await adapter.history.save('geo:ezs42', 'a', '{"content":"public"}');
    await adapter.history.save('mesh', 'a', '{"content":"private","delivery":"read"}');
    adapter.close(); adapter = open(directory);
    const mesh = await adapter.history.load('mesh');
    assert.equal(mesh.length, 1); assert.equal(JSON.parse(mesh[0].value).delivery, 'read');
    assert.equal(JSON.parse((await adapter.history.load('geo:ezs42'))[0].value).content, 'public');
    assert.equal((await adapter.history.load('geo:other')).length, 0);
    await adapter.history.clear(); adapter.close(); adapter = open(directory);
    assert.equal((await adapter.history.load('mesh')).length, 0);
    assert.equal((await adapter.history.load('geo:ezs42')).length, 0);
  } finally { adapter.close(); rmSync(directory, { recursive: true }); }
});
test('indexed pagination has a bounded page, stable order, and no overlap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'outlink-history-'));
  const adapter = open(directory);
  try {
    for (let i = 0; i < 451; ++i) await adapter.history.save('mesh', String(i), JSON.stringify({ id: i }));
    const newest = await adapter.history.load('mesh');
    const older = await adapter.history.load('mesh', newest[0].sequence);
    const oldest = await adapter.history.load('mesh', older[0].sequence);
    assert.equal(newest.length, 200); assert.equal(older.length, 200); assert.equal(oldest.length, 51);
    assert.equal(new Set([...oldest, ...older, ...newest].map(row => row.sequence)).size, 451);
    assert.equal(JSON.parse(newest.at(-1).value).id, 450);
    assert.equal(JSON.parse(oldest[0].value).id, 0);
  } finally { adapter.close(); rmSync(directory, { recursive: true }); }
});
