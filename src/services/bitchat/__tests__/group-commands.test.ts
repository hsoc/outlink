/** @jest-environment node */
import { groupCommand } from '../compatibility/group-commands';
it('parses group commands without interpreting ordinary messages as commands', () => {
  expect(groupCommand('/group create Trail team')).toEqual({ action: 'create', argument: 'Trail team' });
  expect(groupCommand('/GROUP invite @Alice Smith')).toEqual({ action: 'invite', argument: '@Alice Smith' });
  expect(groupCommand('/group remove deadbeef')).toEqual({ action: 'remove', argument: 'deadbeef' });
  for (const action of ['leave', 'list', 'members']) expect(groupCommand(`/group ${action}`)).toEqual({ action });
  expect(groupCommand('a /group command')).toBeNull(); expect(groupCommand('/grouping')).toBeNull();
  expect(() => groupCommand('/group join x')).toThrow(); expect(() => groupCommand('/group create')).toThrow();
});
