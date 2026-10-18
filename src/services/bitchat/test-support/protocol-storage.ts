import type { ProtocolStorage } from '../compatibility/prekey-runtime';
export function memoryStorage(): ProtocolStorage {
  const scopes = new Map<string, Map<string, unknown>>();
  return {
    async get<T>(scope: string, id: string) { return structuredClone(scopes.get(scope)?.get(id) ?? null) as T | null; },
    async list<T>(scope: string, maximum: number) { const values = [...(scopes.get(scope)?.values() ?? [])]; if (values.length > maximum) throw new Error('quota'); return structuredClone(values) as T[]; },
    async put(scope, id, value) { let map = scopes.get(scope); if (!map) { map = new Map(); scopes.set(scope, map); } map.set(id, structuredClone(value)); },
    async remove(scope, id) { scopes.get(scope)?.delete(id); },
  };
}
