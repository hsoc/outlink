import type { AppStateStatus } from '@/platform/ports';
interface MeshConnection { account: string; name: string }
interface GeoConnection { hash: string; name: string; relays: string[] }
export function createSessionLifecycle(
  mesh: { connection?: MeshConnection; stop(): Promise<void>; start(account: string, name: string): Promise<void> },
  geo: { connection?: GeoConnection; stop(): void; join(hash: string, name: string, relays: string[]): Promise<void> },
) {
  let resumeMesh: MeshConnection | undefined, resumeGeo: GeoConnection | undefined;
  let background = false, disposed = false;
  let pending = Promise.resolve();
  return {
    change(state: AppStateStatus): Promise<void> {
      pending = pending.catch(() => {}).then(async () => {
        if (disposed) return;
        if (state === 'background' && !background) {
          background = true;
          resumeMesh = mesh.connection; resumeGeo = geo.connection;
          geo.stop(); await mesh.stop();
        } else if (state === 'active' && background) {
          background = false;
          const m = resumeMesh, g = resumeGeo; resumeMesh = undefined; resumeGeo = undefined;
          if (m) await mesh.start(m.account, m.name).catch(() => {});
          if (g && !disposed) await geo.join(g.hash, g.name, g.relays).catch(() => {});
        }
      });
      return pending;
    },
    dispose() {
      disposed = true;
      void pending.catch(() => {}).then(async () => { geo.stop(); await mesh.stop(); }).catch(() => {});
    },
  };
}
