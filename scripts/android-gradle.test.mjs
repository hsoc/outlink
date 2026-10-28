import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { androidGradleArguments, runAndroidGradle } from './android-gradle.mjs';
test('native release tasks use serial Gradle scheduling and detailed logs', () => {
  const args = androidGradleArguments([':app:assembleRelease', ':app:bundleRelease']);
  assert.ok(args.includes('--no-parallel')); assert.ok(args.includes('--max-workers=1'));
  assert.ok(args.includes('--info')); assert.ok(args.includes('--stacktrace'));
});
test('captures output, strips signing secrets from native workers and propagates failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'outlink-gradle-'));
  try {
    await runAndroidGradle(process.execPath, ['-e', "if(process.env.ANDROID_KEYSTORE_PASSWORD)process.exit(9);console.log('native configuration completed')"], { diagnosticsDirectory: directory, env: { ...process.env, ANDROID_KEYSTORE_PASSWORD: 'do-not-log' } });
    assert.match(readFileSync(join(directory, 'gradle.log'), 'utf8'), /configuration completed/);
    assert.doesNotMatch(readFileSync(join(directory, 'gradle.log'), 'utf8'), /do-not-log/);
    await assert.rejects(runAndroidGradle(process.execPath, ['-e', 'process.exit(7)'], { diagnosticsDirectory: directory }), /failed \(7\)/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('terminates a silent process, captures diagnostics and leaves no running child', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'outlink-gradle-stall-'));
  let captured = false;
  try {
    await assert.rejects(runAndroidGradle(process.execPath, ['-e', "console.log(process.pid);setInterval(()=>{},1000)"], { diagnosticsDirectory: directory, stallMs: 150, heartbeatMs: 50, diagnostics: () => { captured = true; } }), /stalled/);
    assert.equal(captured, true);
    assert.equal(existsSync(join(directory, 'gradle.log')), true);
    const pid = Number(readFileSync(join(directory, 'gradle.log'), 'utf8').trim());
    assert.throws(() => process.kill(pid, 0));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
