/** @jest-environment node */
import { mentionMatcher, mentionText, appendMention } from '../mentions';
it.each([
  ['Alice', 'hello @Alice!', true], ['Alice', '@alice', true], ['Alice', '@Alicee', false],
  ['Alice', '@Alice-Bob', false], ['Alice', 'email@Alice.com', false], ['Alice', '@@Alice', false],
  ['Alice Smith', '@Alice Smith', false], ['Alice Smith', '@{Alice Smith}', true],
  ['Alice', '@{Alice Smith}', false], ['A+B', '@{A+B}', true], ['A+B', '@{AAAB}', false],
  ['Élodie', '@E\u0301lodie', true], ['张三', 'hi @张三!', true], ['', '@anything', false],
])('matches %s in %s precisely', (name, content, expected) => {
  const matches = mentionMatcher(name as string); expect(matches(content as string)).toBe(expected);
  expect(matches(content as string)).toBe(expected);
});
it('formats ambiguous names explicitly and appends without joining words', () => {
  expect(mentionText('Alice')).toBe('@Alice '); expect(mentionText('Alice Smith')).toBe('@{Alice Smith} ');
  expect(appendMention('hello', 'Alice')).toBe('hello @Alice '); expect(appendMention('', 'Alice')).toBe('@Alice ');
});
