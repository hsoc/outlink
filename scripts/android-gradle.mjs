import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export const androidGradleArguments = tasks => [...tasks, '--no-daemon', '--no-parallel', '--max-workers=1', '--console=plain', '--info', '--stacktrace'];

function captureDiagnostics(folder) {
  mkdirSync(folder, { recursive: true });
  // Process names and Java stacks only: never collect environment variables or signing files.
  const processes = spawnSync('ps', ['-eo', 'pid,ppid,stat,%cpu,%mem,etime,comm'], { encoding: 'utf8', timeout: 5000 });
  writeFileSync(join(folder, 'processes.txt'), processes.stdout ?? 'Process list unavailable');
  const java = spawnSync('jcmd', ['-l'], { encoding: 'utf8', timeout: 5000 });
  for (const line of (java.stdout ?? '').split('\n').filter(line => /GradleDaemon|GradleWrapperMain|prefab/.test(line)).slice(0, 4)) {
    const pid = line.match(/^\d+/)?.[0];
    if (!pid) continue;
    const stack = spawnSync('jcmd', [pid, 'Thread.print'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    writeFileSync(join(folder, `java-${pid}.txt`), stack.stdout || stack.stderr || 'Thread dump unavailable');
  }
}

/** Bound native-build stalls and retain useful diagnostics before terminating the process group. */
export async function runAndroidGradle(command, args, {
  cwd, env = process.env, stallMs = 15 * 60 * 1000, heartbeatMs = 30000,
  diagnosticsDirectory = 'release/android-diagnostics', diagnostics = captureDiagnostics,
} = {}) {
  mkdirSync(diagnosticsDirectory, { recursive: true });
  const log = join(diagnosticsDirectory, 'gradle.log');
  const nativeEnv = { ...env, CMAKE_BUILD_PARALLEL_LEVEL: '2' };
  for (const key of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) delete nativeEnv[key];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: nativeEnv, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let lastOutput = performance.now(), stopped = false, killTimer;
    const started = lastOutput;
    const stop = signal => {
      try { if (process.platform === 'win32') child.kill(signal); else if (child.pid) process.kill(-child.pid, signal); } catch { /* Process already exited. */ }
    };
    const output = (stream, data) => {
      lastOutput = performance.now(); stream.write(data); appendFileSync(log, data);
    };
    child.stdout.on('data', data => output(process.stdout, data));
    child.stderr.on('data', data => output(process.stderr, data));
    const timer = setInterval(() => {
      const now = performance.now(), silent = now - lastOutput;
      if (stopped) return;
      if (silent < stallMs) {
        console.log(`Android native build: ${Math.floor((now - started) / 1000)}s elapsed; ${Math.floor(silent / 1000)}s since Gradle output.`);
        return;
      }
      stopped = true;
      console.error(`Android native build stalled: no Gradle output for ${Math.floor(silent / 1000)}s. Capturing diagnostics.`);
      try { diagnostics(diagnosticsDirectory); } catch (error) { console.error(`Diagnostic capture failed: ${error.message}`); }
      stop('SIGTERM');
      killTimer = setTimeout(() => stop('SIGKILL'), 5000);
    }, Math.min(heartbeatMs, stallMs));
    const cleanup = () => { clearInterval(timer); clearTimeout(killTimer); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      if (stopped) reject(new Error('Android native build stalled; see android-build-diagnostics artifact.'));
      else if (code !== 0) reject(new Error(`Android native build failed (${code ?? signal}); see Gradle output.`));
      else resolve();
    });
  });
}
