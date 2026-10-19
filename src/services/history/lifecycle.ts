import type { AppStateStatus } from '@/platform/ports';
let intentEpoch = 0;
export const sessionIntent = () => intentEpoch;
export const invalidateSessionIntent = () => { ++intentEpoch; };
interface MeshConnection { account: string; name: string }
interface GeoConnection { hash: string; name: string; relays: string[] }
interface BackgroundPolicy {
  enabled(): boolean;
  start(): Promise<void>;
  running(): Promise<boolean>;
  stop(): Promise<void>;
  failed(): void;
}
export function createSessionLifecycle(
  mesh: { connection?: MeshConnection; stop(): Promise<void>; start(account: string, name: string): Promise<void> },
  geo: { connection?: GeoConnection; stop(): void; join(hash: string, name: string, relays: string[]): Promise<void> },
  policy?: BackgroundPolicy,
) {
  let resumeMesh: MeshConnection | undefined, resumeGeo: GeoConnection | undefined;
  let background = false, paused = false, disposed = false, resumeEpoch = intentEpoch;
  let pending = Promise.resolve();
  const stopKeeper = () => policy?.stop().catch(() => {});
  async function pause() {
    if (paused) return;
    paused = true; resumeEpoch = intentEpoch;
    resumeMesh = mesh.connection; resumeGeo = geo.connection;
    geo.stop(); await mesh.stop();
  }
  return {
    change(state: AppStateStatus): Promise<void> {
      pending = pending.catch(() => {}).then(async () => {
        if (disposed) return;
        if (state === 'active') {
          background = false;
          if (paused) {
            paused = false;
            const m = resumeMesh, g = resumeGeo; resumeMesh = undefined; resumeGeo = undefined;
            if (resumeEpoch === intentEpoch) {
              if (m) await mesh.start(m.account, m.name).catch(() => {});
              if (g && !disposed && resumeEpoch === intentEpoch) await geo.join(g.hash, g.name, g.relays).catch(() => {});
            }
          }
          if (policy?.enabled() && mesh.connection) {
            try { await policy.start(); } catch { await stopKeeper(); policy.failed(); }
          } else await stopKeeper();
        } else if (state === 'background' || background) {
          background = true;
          let keep = false;
          if (policy?.enabled() && mesh.connection) {
            try { keep = await policy.running(); } catch { /* Pause when native status is unavailable. */ }
            if (!keep) policy.failed();
          }
          if (!keep) { try { await pause(); } finally { await stopKeeper(); } }
        }
      });
      return pending;
    },
    dispose() {
      disposed = true;
      void pending.catch(() => {}).then(async () => {
        geo.stop(); try { await mesh.stop(); } finally { await stopKeeper(); }
      }).catch(() => {});
    },
  };
}
