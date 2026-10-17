/** @jest-environment node */
import { platform } from '@/platform';
import { saveMessage, loadMessages, clearHistory } from '../history';
jest.mock('@/platform', () => ({ platform: { history: { save: jest.fn(), load: jest.fn(), clear: jest.fn() } } }));
it('serializes in-flight saves before deletion and new arrivals after deletion', async () => {
  const calls: string[] = [];
  let release!: () => void;
  jest.mocked(platform.history.save).mockImplementationOnce(async () => {
    calls.push('old'); await new Promise<void>(resolve => { release = resolve; });
  }).mockImplementationOnce(async () => { calls.push('new'); });
  jest.mocked(platform.history.clear).mockImplementation(async () => { calls.push('clear'); });
  const old = saveMessage('mesh', 'old', { content: 'old' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const clear = clearHistory(), next = saveMessage('mesh', 'new', { content: 'new' });
  expect(calls).toEqual(['old']); release();
  await Promise.all([old, clear, next]); expect(calls).toEqual(['old', 'clear', 'new']);
});
it('restores interrupted sending as failed, preserving confirmed delivery and pagination', async () => {
  jest.mocked(platform.history.load).mockResolvedValue([
    { sequence: 17, value: JSON.stringify({ id: 'a', delivery: 'sending' }) },
    { sequence: 18, value: JSON.stringify({ id: 'b', delivery: 'read' }) },
  ]);
  const page = await loadMessages('geo:ezs42', 100);
  expect(page.before).toBe(17); expect(page.messages.map(m => m.delivery)).toEqual(['failed', 'read']);
  expect(platform.history.load).toHaveBeenCalledWith('geo:ezs42', 100);
});
it('surfaces write failures and continues processing subsequent operations', async () => {
  jest.mocked(platform.history.save).mockRejectedValueOnce(new Error('disk full'));
  await expect(saveMessage('mesh', 'id', {})).rejects.toThrow('disk full');
  await expect(clearHistory()).resolves.toBeUndefined();
});
