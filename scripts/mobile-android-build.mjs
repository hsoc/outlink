import { androidGradleArguments, runAndroidGradle } from './android-gradle.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { signAndroid, signAndroidBundle, signingMode } from './release-signing.mjs';
function run(command,args,cwd=process.cwd()) {
  const env = { ...process.env, EXPO_PUBLIC_APP_ENV: 'production' };
  for (const key of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) delete env[key];
  const result=spawnSync(command,args,{cwd,env,stdio:'inherit'});
  if(result.error||result.status!==0)throw new Error(`Android build failed: ${command}`);
}
const signing=signingMode('android');
run('npm',['run','android:prebuild']);
if(signing==='signed') {
  const path='android/app/build.gradle';
  writeFileSync(path,readFileSync(path,'utf8').replace(/^.*signingConfig signingConfigs.debug.*\n/gm,''));
}
// Release bundles must not inherit the generated debug signing configuration.
// Without release credentials, build only a debug-signed testing APK.
const tasks = [':app:assembleRelease', ...(signing==='signed' ? [':app:bundleRelease'] : [])];
await runAndroidGradle('./gradlew', androidGradleArguments(tasks), { cwd: 'android', env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'production' } });
const folder='android/app/build/outputs/apk/release/';
const input=folder+(signing==='signed'?'app-release-unsigned.apk':'app-release.apk');
if(!existsSync(input))throw new Error('APK output missing');
mkdirSync('release',{recursive:true});
signAndroid(input,'release/Outlink-android.apk');
run('python3', ['scripts/android-r8-report.py', '--apk', 'release/Outlink-android.apk', '--mapping', 'android/app/build/outputs/mapping/release', '--output', 'release/android-r8-report.json']);
if(signing==='signed') {
  const bundle='android/app/build/outputs/bundle/release/app-release.aab';
  if(!existsSync(bundle))throw new Error('AAB output missing');
  signAndroidBundle(bundle,'release/Outlink-android.aab');
} else {
  console.log('Android signing secrets not configured; skipping Play Store AAB.');
}
