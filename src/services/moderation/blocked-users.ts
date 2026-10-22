import { createStore } from 'zustand/vanilla';
import { readRecord, putRecord } from '@/services/bitchat/compatibility/storage';
import { sessionIntent } from '@/services/history/lifecycle';
export type BlockedUser = { key: string; name: string; group?: string };
export const blockedUsersStore = createStore<{ users: BlockedUser[] }>(() => ({ users: [] }));
let blockedKeys = new Set<string>();
blockedUsersStore.subscribe(state => { blockedKeys = new Set(state.users.map(user => user.key)); });
let loading: Promise<void> | undefined, pending = Promise.resolve();
export const blockedUsers = {
  restore(): Promise<void> {
    return loading ??= (async () => {
      const epoch = sessionIntent(), users = await readRecord<BlockedUser[]>('message-blocks', 'users') ?? [];
      if (epoch === sessionIntent()) blockedUsersStore.setState({ users });
    })().catch(error => { loading = undefined; throw error; });
  },
  has(key: string) { return blockedKeys.has(key); },
  set(keys: string[], name: string, blocked: boolean) {
    const epoch = sessionIntent();
    const work = pending.catch(() => {}).then(async () => {
      await this.restore();
      if (epoch !== sessionIntent()) throw new Error('Block change canceled by identity erasure');
      const next = blockedUsersStore.getState().users.filter(user => !keys.includes(user.key));
      if (blocked) for (const key of new Set(keys)) {
        if (!/^(mesh:[0-9a-f]{16}|nostr:[0-9a-f]{64})$/.test(key)) throw new Error('Invalid block identity');
        next.push({ key, name, group: keys[0] });
      }
      if (next.length > 2000) throw new Error('Block list is full');
      await putRecord('message-blocks', 'users', next);
      if (epoch === sessionIntent()) blockedUsersStore.setState({ users: next });
    });
    pending = work; return work;
  },
  reset() { loading = undefined; blockedUsersStore.setState({ users: [] }); },
};
