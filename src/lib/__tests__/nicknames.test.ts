/** @jest-environment node */
import { displayNickname, nicknameBase } from '../nicknames';
import { mentionMatcher, mentionText } from '../mentions';
it('derives discriminators from identity rather than supplied suffixes', () => {
  expect(displayNickname('Alice#ffff', '12345678abcdef12')).toBe('Alice#12345678');
  expect(displayNickname('Alice#ffffffff', 'bridge:abcdef0123456789')).toBe('Alice#abcdef01');
  expect(nicknameBase(' Alice#abcdef01 ')).toBe('Alice');
  expect(displayNickname('Outlink', 'abcd123400000000')).toBe('Outlink#abcd1234');
});
it('uses the same mesh suffix for a short peer ID and full fingerprint, while separate public identities differ', () => {
  expect(displayNickname('Alice', '12345678abcdef12')).toBe(displayNickname('Alice', '12345678abcdef12' + '0'.repeat(48)));
  expect(displayNickname('Alice', '87654321' + '0'.repeat(56))).not.toBe(displayNickname('Alice', '12345678abcdef12'));
});
it('mentions the complete discriminated nickname without matching other suffixes', () => {
  expect(mentionText('Alice#12345678')).toBe('@Alice#12345678 ');
  expect(mentionMatcher('Alice#12345678')('hi @Alice#12345678')).toBe(true);
  expect(mentionMatcher('Alice#12345678')('hi @Alice#87654321')).toBe(false);
  expect(mentionMatcher('Alice')('hi @Alice#12345678')).toBe(false);
});
