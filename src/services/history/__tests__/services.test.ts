/** @jest-environment node */
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { geohashService, geohashStore } from '@/services/geohash/geohash.service';
import { platform } from '@/platform';
import { historyOperation } from '../history';
jest.mock('@/platform', () => ({ platform: {
  history: { save: jest.fn(async () => {}), load: jest.fn(async () => []), clear: jest.fn(async () => {}) },
  secureStorage: { getItem: jest.fn(async () => JSON.stringify({ noise: '01'.repeat(32), signing: '02'.repeat(32) })) },
  records: { list: jest.fn(async () => []) },
  proximityTransport: {},
} }));
jest.mock('@/services/bitchat/bitchat-session', () => ({ BitchatSession: jest.fn().mockImplementation(() => ({
  id: 'self', start: jest.fn(async () => {}), stop: jest.fn(async () => {}),
})) }));
it('leaving Bluetooth keeps saved public and private conversations and settles interrupted sends', async () => {
  const messages = [
    { id: 'a', peer: 'bob', name: 'Bob', content: 'public', timestamp: 1, outgoing: false, delivery: 'sent' as const },
    { id: 'b', peer: 'self', recipient: 'bob', name: 'Alice', content: 'private', timestamp: 2, outgoing: true, delivery: 'sending' as const },
  ];
  bitchatSessionStore.setState({ messages });
  await bitchatService.stop();
  expect(bitchatSessionStore.getState().messages.map(m => m.content)).toEqual(['public', 'private']);
  expect(bitchatSessionStore.getState().messages[1].delivery).toBe('failed');
  await historyOperation(async () => {});
  expect(platform.history.save).toHaveBeenCalledWith('mesh', 'bself', expect.stringContaining('failed'));
});
it('leaving a location channel retains its timeline and selection', () => {
  geohashStore.setState({ hash: 'ezs42', messages: [{ id: 'event', pubkey: 'key', name: 'Alice', content: 'hello', timestamp: 1, outgoing: true, delivery: 'sending' }] });
  geohashService.stop();
  expect(geohashStore.getState()).toMatchObject({ active: false, hash: 'ezs42', messages: [expect.objectContaining({ content: 'hello', delivery: 'failed' })] });
});
it('restores history without opening a Bluetooth transport', async () => {
  jest.mocked(platform.history.load).mockResolvedValueOnce([{ sequence: 1, value: JSON.stringify({ id: 'persisted', peer: 'bob', name: 'Bob', content: 'saved', timestamp: 1, outgoing: false, delivery: 'read' }) }]);
  await bitchatService.latest();
  expect(bitchatSessionStore.getState().messages[0].content).toBe('saved');
  expect(bitchatSessionStore.getState().active).toBe(false);
});
it('a pending history read cannot restore messages after explicit deletion', async () => {
  let release!: (rows: { sequence: number; value: string }[]) => void;
  jest.mocked(platform.history.load).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const loading = geohashService.restore('u4pr');
  await new Promise(resolve => setTimeout(resolve, 0));
  geohashService.clearMessages();
  release([{ sequence: 12, value: JSON.stringify({ id: 'old', content: 'deleted', delivery: 'sent' }) }]);
  await loading;
  expect(geohashStore.getState().messages).toEqual([]);
});
