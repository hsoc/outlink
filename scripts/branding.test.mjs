import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const json = async path => JSON.parse(await readFile(path, 'utf8'));

test('native, Expo, and desktop production identities agree', async () => {
  const identities = await json('config/app-identities.json');
  const app = (await json('app.json')).expo;
  const desktop = await json('desktop/package.json');
  assert.equal(identities.production.id, 'io.github.hsoc.outlink');
  assert.equal(app.ios.appleTeamId, undefined);
  assert.equal(app.name, identities.production.name);
  assert.equal(app.scheme, identities.production.scheme);
  assert.equal(app.ios.bundleIdentifier, identities.production.id);
  assert.equal(app.android.package, identities.production.id);
  assert.equal(desktop.build.appId, identities.production.id);
  assert.equal(desktop.build.productName, identities.production.name);
  assert.equal(desktop.name, identities.production.packageName);
  assert.equal(desktop.build.publish.owner, 'hsoc');
  assert.equal(desktop.build.publish.repo, 'outlink');
});

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true }))
    .map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

test('JNI exported names match the renamed Kotlin module packages', async () => {
  for (const module of ['expo-noise', 'expo-crypto-accelerator']) {
    const root = `modules/${module}/android/src/main`;
    const kotlin = (await files(`${root}/java`)).filter(path => path.endsWith('.kt'));
    assert.equal(kotlin.length, 1);
    const source = await readFile(kotlin[0], 'utf8');
    const packageName = source.match(/^package ([\w.]+)/m)[1];
    const className = source.match(/^class (\w+)\s*:\s*Module\(/m)[1];
    const expected = `Java_${packageName.replaceAll('.', '_')}_${className}_`;
    const native = (await files(`${root}/cpp`)).filter(path => /\.(c|cpp)$/.test(path));
    let exports = 0;
    for (const path of native) {
      for (const match of (await readFile(path, 'utf8')).matchAll(/\b(Java_\w+)\s*\(/g)) {
        assert.ok(match[1].startsWith(expected), `${path}: ${match[1]}`);
        exports++;
      }
    }
    assert.ok(exports > 0);
  }
});
