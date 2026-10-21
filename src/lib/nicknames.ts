import english from '@/i18n/en.json';
/** Display-only identity labels. Full cryptographic keys remain authoritative. */
export function nicknameBase(value: string): string {
  return value.trim().replace(/#[0-9a-f]{4,8}$/i, '').trim();
}
export function nicknameDiscriminator(identity: string): string {
  const raw = identity.replace(/^bridge:/, '').toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(raw)) return '';
  return raw.slice(0, 8);
}
export function displayNickname(name: string, identity: string): string {
  const tag = nicknameDiscriminator(identity), base = nicknameBase(name) || english.mobile.unknown_nickname;
  return tag ? `${base}#${tag}` : base;
}
