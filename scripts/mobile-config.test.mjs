import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
test('only Android and iOS applications and the Bitchat native module ship', async()=>{
  const app=(await read('app.json')).expo, pkg=await read('package.json');
  assert.deepEqual(app.platforms,['ios','android']);assert.equal(pkg.workspaces,undefined);
  assert.equal(app.android.package,'io.github.hsoc.outlink');assert.equal(app.ios.bundleIdentifier,'io.github.hsoc.outlink');
  assert.equal(app.ios.entitlements?.['aps-environment'],undefined);
  for(const dep of ['electron','electron-builder','@getalby/sdk'])assert.equal(pkg.dependencies[dep],undefined);
  assert.deepEqual((await readdir('modules')).sort(),['expo-proximity']);
  assert.deepEqual((await readdir('src/app')).sort(),['+native-intent.tsx','_layout.tsx','contacts.tsx','groups.tsx','index.tsx','licenses.tsx','payments.tsx','settings.tsx']);
});
test('both native modes still advertise the standard Bitchat BLE service', async()=>{
  const files=['modules/expo-proximity/ios/ExpoProximityModule.swift','modules/expo-proximity/android/src/main/java/io/github/hsoc/outlink/proximity/ExpoProximityModule.kt'];
  for(const path of files)assert.match((await readFile(path,'utf8')).toLowerCase(),/f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c/);
});

test('QR scanning does not record audio and Nearby recording stays foreground-only', async()=>{
  const app=(await read('app.json')).expo;
  const plugin=app.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-camera');
  assert.equal(plugin[1].recordAudioAndroid,false);
  assert.ok(!app.android.blockedPermissions.includes('android.permission.CAMERA'));
  assert.ok(!app.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));
  const audio=app.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-audio');
  assert.equal(audio[1].enableBackgroundRecording,false); assert.equal(audio[1].enableBackgroundPlayback,false);
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
  assert.equal(mods.ios.infoPlist.NSMicrophoneUsageDescription, 'Allow Outlink to record Nearby voice notes.');
  assert.ok(!(mods.ios.infoPlist.UIBackgroundModes ?? []).includes('audio'));
  const microphone = mods.android.manifest.manifest['uses-permission'].filter(entry => entry.$['android:name'] === 'android.permission.RECORD_AUDIO');
  assert.ok(microphone.some(entry => entry.$['tools:node'] !== 'remove'));
  assert.ok(microphone.every(entry => entry.$['tools:node'] !== 'remove'));
  const metadata = mods.android.manifest.manifest.application[0]['meta-data'];
  for (const name of ['firebase_messaging_auto_init_enabled', 'firebase_analytics_collection_enabled'])
    assert.equal(metadata.find(item => item.$['android:name'] === name).$['android:value'], 'false');
  const adapter = await readFile('src/platform/expo/mention-notifications.ts', 'utf8');
  assert.ok(!adapter.includes("from 'expo-notifications';"));
  assert.ok(!/getExpoPushTokenAsync|getDevicePushTokenAsync/.test(adapter));
});


test('Android composite builds align AGP 9 and Kotlin versions', async () => {
  const catalogs = await Promise.all([
    'node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml',
    'node_modules/react-native/gradle/libs.versions.toml',
  ].map(path => readFile(path, 'utf8')));
  const version = (catalog, name) => catalog.match(new RegExp(`^${name} = "([^"\\n]+)"`, 'm'))?.[1];
  const agp = version(catalogs[0], 'agp'), kotlin = version(catalogs[0], 'kotlin');
  assert.match(agp, /^9\./);
  assert.equal(version(catalogs[1], 'agp'), agp);
  assert.equal(version(catalogs[1], 'kotlin'), kotlin);
  assert.ok(kotlin.startsWith('2.2.'));
  for (const path of [
    'node_modules/expo-modules-core/expo-module-gradle-plugin/build.gradle.kts',
    'node_modules/expo-modules-autolinking/android/expo-gradle-plugin/build.gradle.kts',
  ]) {
    assert.ok((await readFile(path, 'utf8')).includes(`kotlin("jvm") version "${kotlin}"`));
  }
  for (const path of [
    'node_modules/expo-modules-core/expo-module-gradle-plugin/build.gradle.kts',
    'node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-settings-plugin/build.gradle.kts',
    'node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-max-sdk-override-plugin/build.gradle.kts',
    'node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/build.gradle.kts',
  ]) {
    assert.ok((await readFile(path, 'utf8')).includes(`compileOnly("com.android.tools.build:gradle:${agp}")`));
  }
  const sourceProperties = await readFile('node_modules/react-native/gradle.properties', 'utf8');
  assert.match(sourceProperties, /^android.newDsl=false$/m);
  assert.match(sourceProperties, /^android.builtInKotlin=false$/m);
});


test('native animation libraries register React before Kotlin script configuration', async () => {
  for (const packageName of ['react-native-worklets', 'react-native-reanimated']) {
    const source = await readFile(`node_modules/${packageName}/android/build.gradle.kts`, 'utf8');
    const plugins = source.match(/^plugins \{([\s\S]*?)^\}/m)?.[1] ?? '';
    assert.ok(plugins.includes('id("com.facebook.react")'), packageName);
    assert.ok(!source.includes('apply(plugin = "com.facebook.react")'), packageName);
  }
});
