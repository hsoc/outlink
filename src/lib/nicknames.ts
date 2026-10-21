import english from '@/i18n/en.json';
/** Display-only identity labels. Full cryptographic keys remain authoritative. */
export function nicknameBase(value: string): string {
  return value.trim().replace(/#[0-9a-f]{4,8}$/i, '').trim();
}
export function nicknameDiscriminator(identity: string): string {
  const raw = identity.replace(/^bridge:/, '').toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(raw)) return '';
  return raw.slice(0, 4);
}
export function displayNickname(name: string, identity: string, disambiguate = false): string {
  const tag = nicknameDiscriminator(identity), base = nicknameBase(name) || english.mobile.unknown_nickname;
  return disambiguate && tag ? `${base}#${tag}` : base;
}

/** Count distinct active identities only; callers supply their transport's live roster. */
export function nicknameKey(name: string): string { return nicknameBase(name).normalize('NFC').toLowerCase(); }
export function duplicateNicknames(participants: { name: string; identity: string }[]): Set<string> {
  const first = new Map<string, string>(), duplicates = new Set<string>();
  for (const { name, identity } of participants) {
    if (!identity) continue;
    const key = nicknameKey(name);
    if (first.has(key) && first.get(key) !== identity) duplicates.add(key);
    else first.set(key, identity);
  }
  return duplicates;
}
/** Accept the previous eight-character mention format during migration. */
export function nicknameMentionLabels(name: string, identity: string): string[] {
  const short = displayNickname(name, identity, true), raw = identity.replace(/^bridge:/, '').toLowerCase();
  return nicknameDiscriminator(identity) ? [short, `${nicknameBase(name)}#${raw.slice(0, 8)}`] : [short];
}
