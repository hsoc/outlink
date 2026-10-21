/** @jest-environment node */
import { displayNickname, nicknameBase, duplicateNicknames, nicknameKey, nicknameMentionLabels } from '../nicknames';
import { mentionMatcher, mentionText } from '../mentions';
it('derives discriminators from identity rather than supplied suffixes', () => {
  expect(displayNickname('Alice#ffff', '12345678abcdef12', true)).toBe('Alice#1234');
  expect(displayNickname('Alice#ffffffff', 'bridge:abcdef0123456789', true)).toBe('Alice#abcd');
  expect(nicknameBase(' Alice#abcdef01 ')).toBe('Alice');
  expect(displayNickname('Outlink', 'abcd123400000000', true)).toBe('Outlink#abcd');
});
it('uses the same mesh suffix for a short peer ID and full fingerprint, while separate public identities differ', () => {
  expect(displayNickname('Alice', '12345678abcdef12', true)).toBe(displayNickname('Alice', '12345678abcdef12' + '0'.repeat(48), true));
  expect(displayNickname('Alice', '87654321' + '0'.repeat(56), true)).not.toBe(displayNickname('Alice', '12345678abcdef12', true));
});
it('mentions the complete discriminated nickname without matching other suffixes', () => {
  expect(mentionText('Alice#12345678')).toBe('@Alice#12345678 ');
  expect(mentionMatcher('Alice#12345678')('hi @Alice#12345678')).toBe(true);
  expect(mentionMatcher('Alice#12345678')('hi @Alice#87654321')).toBe(false);
  expect(mentionMatcher('Alice')('hi @Alice#12345678')).toBe(false);
});

it('hides suffixes unless distinct active identities share a normalized base', () => {
  const active = [{ name: 'Alice', identity: '12345678' }, { name: ' ALICE#ffff ', identity: 'abcdef00' }];
  const duplicates = duplicateNicknames(active);
  expect(displayNickname('Alice', active[0].identity, duplicates.has(nicknameKey('Alice')))).toBe('Alice#1234');
  expect(displayNickname('Bob#ffff', 'abcdef00')).toBe('Bob');
  expect(duplicateNicknames([active[0], active[0]]).size).toBe(0);
  expect(duplicateNicknames(active.slice(0, 1)).size).toBe(0);
  expect(duplicateNicknames([{ name: 'é', identity: '1' }, { name: 'e\u0301', identity: '2' }]).size).toBe(1);
});
it('accepts four-character and previous eight-character qualified mentions', () => {
  const labels = nicknameMentionLabels('Alice', '12345678abcdef00');
  expect(mentionText(labels[0])).toBe('@Alice#1234 ');
  for (const label of labels) expect(labels.some(name => mentionMatcher(name)(mentionText(label)))).toBe(true);
  expect(labels.some(name => mentionMatcher(name)('@Alice#ffff'))).toBe(false);
});
