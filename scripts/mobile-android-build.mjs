import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { signAndroid, signingMode } from './release-signing.mjs';
function run(command,args,cwd=process.cwd()) {
  const result=spawnSync(command,args,{cwd,env:{...process.env,EXPO_PUBLIC_APP_ENV:'production'},stdio:'inherit'});
  if(result.error||result.status!==0)throw new Error(`Android build failed: ${command}`);
}
const signing=signingMode('android');
run('npm',['run','android:prebuild']);
if(signing==='signed') {
  const path='android/app/build.gradle';
  writeFileSync(path,readFileSync(path,'utf8').replace(/^.*signingConfig signingConfigs.debug.*\n/gm,''));
}
run('./gradlew',[':app:assembleRelease','--no-daemon','--max-workers=2'],'android');
const folder='android/app/build/outputs/apk/release/';
const input=folder+(signing==='signed'?'app-release-unsigned.apk':'app-release.apk');
if(!existsSync(input))throw new Error('APK output missing');
mkdirSync('release',{recursive:true});
signAndroid(input,'release/Outlink-android.apk');
