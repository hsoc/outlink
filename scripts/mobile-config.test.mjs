import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
test('only Android and iOS applications and the Bitchat native module ship', async()=>{
  const app=(await read('app.json')).expo, pkg=await read('package.json');
  assert.deepEqual(app.platforms,['ios','android']);assert.equal(pkg.workspaces,undefined);
  assert.equal(app.android.package,'io.github.hsoc.outlink');assert.equal(app.ios.bundleIdentifier,'io.github.hsoc.outlink');
  assert.equal(app.ios.entitlements?.['aps-environment'],undefined);
  for(const dep of ['electron','electron-builder','@getalby/sdk','expo-audio'])assert.equal(pkg.dependencies[dep],undefined);
  assert.deepEqual((await readdir('modules')).sort(),['expo-proximity']);
  assert.deepEqual((await readdir('src/app')).sort(),['+native-intent.tsx','_layout.tsx','contacts.tsx','index.tsx','licenses.tsx','settings.tsx']);
});
test('both native modes still advertise the standard Bitchat BLE service', async()=>{
  const files=['modules/expo-proximity/ios/ExpoProximityModule.swift','modules/expo-proximity/android/src/main/java/io/github/hsoc/outlink/proximity/ExpoProximityModule.kt'];
  for(const path of files)assert.match((await readFile(path,'utf8')).toLowerCase(),/f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c/);
});

test('QR scanning grants camera access without microphone or push permissions', async()=>{
  const app=(await read('app.json')).expo;
  const plugin=app.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-camera');
  assert.equal(plugin[1].recordAudioAndroid,false); assert.equal(plugin[1].microphonePermission,false);
  assert.ok(!app.android.blockedPermissions.includes('android.permission.CAMERA'));
  assert.ok(app.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));
});

test('unused SQLite full-text extensions are disabled in both native builds', async()=>{
  const app=(await read('app.json')).expo;
  const plugin=app.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-sqlite');
  assert.equal(plugin[1].enableFTS,false);
});

test('local mention alerts do not enable remote push registration', async () => {
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, EXPO_OFFLINE: '1' },
  });
  const mods = JSON.parse(output)._internal.modResults;
  assert.equal(mods.ios.entitlements['aps-environment'], undefined);
  assert.ok(!(mods.ios.infoPlist.UIBackgroundModes ?? []).includes('remote-notification'));
  const metadata = mods.android.manifest.manifest.application[0]['meta-data'];
  for (const name of ['firebase_messaging_auto_init_enabled', 'firebase_analytics_collection_enabled'])
    assert.equal(metadata.find(item => item.$['android:name'] === name).$['android:value'], 'false');
  const adapter = await readFile('src/platform/expo/mention-notifications.ts', 'utf8');
  assert.ok(!adapter.includes("from 'expo-notifications';"));
  assert.ok(!/getExpoPushTokenAsync|getDevicePushTokenAsync/.test(adapter));
});
