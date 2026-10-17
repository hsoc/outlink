import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
test('only Android and iOS applications and the Bitchat native module ship', async()=>{
  const app=(await read('app.json')).expo, pkg=await read('package.json');
  assert.deepEqual(app.platforms,['ios','android']);assert.equal(pkg.workspaces,undefined);
  assert.equal(app.android.package,'io.github.hsoc.outlink');assert.equal(app.ios.bundleIdentifier,'io.github.hsoc.outlink');
  assert.equal(app.ios.entitlements?.['aps-environment'],undefined);
  for(const dep of ['electron','electron-builder','@getalby/sdk','expo-camera','expo-audio'])assert.equal(pkg.dependencies[dep],undefined);
  assert.deepEqual((await readdir('modules')).sort(),['expo-proximity']);
  assert.deepEqual((await readdir('src/app')).sort(),['+native-intent.tsx','_layout.tsx','index.tsx','licenses.tsx','settings.tsx']);
});
test('both native modes still advertise the standard Bitchat BLE service', async()=>{
  const files=['modules/expo-proximity/ios/ExpoProximityModule.swift','modules/expo-proximity/android/src/main/java/io/github/hsoc/outlink/proximity/ExpoProximityModule.kt'];
  for(const path of files)assert.match((await readFile(path,'utf8')).toLowerCase(),/f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c/);
});
