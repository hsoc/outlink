/** Nickname mentions stay plain text on both existing wire protocols. */
const simpleName = /^[\p{L}\p{N}_-]+(?:#[0-9a-f]{4}(?:[0-9a-f]{4})?)?$/iu;
export function mentionMatcher(nickname: string): (content: string) => boolean {
  const name = nickname.normalize('NFC').trim();
  if (!name) return () => false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = [`@\\{${escaped}\\}`];
  if (simpleName.test(name)) forms.push(`@${escaped}(?![\\p{L}\\p{N}_#-])`);
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_@])(?:${forms.join('|')})`, 'iu');
  return content => pattern.test(content.normalize('NFC'));
}
export function mentionText(name: string): string {
  const value = name.trim(); return (simpleName.test(value) ? `@${value}` : `@{${value}}`) + ' ';
}
export function appendMention(content: string, name: string): string {
  return content + (content && !/\s$/.test(content) ? ' ' : '') + mentionText(name);
}
