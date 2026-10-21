export type GroupCommand = { action: 'create' | 'invite' | 'remove'; argument: string } | { action: 'leave' | 'list' | 'members' };
/** Recognized commands never fall through into a public or encrypted message. */
export function groupCommand(input: string): GroupCommand | null {
  if (!/^\/group(?:\s|$)/i.test(input.trim())) return null;
  const match = /^\/group\s+(create|invite|remove)\s+(.+)$/i.exec(input.trim());
  if (match) return { action: match[1].toLowerCase() as 'create' | 'invite' | 'remove', argument: match[2].trim() };
  const simple = /^\/group\s+(leave|list|members)$/i.exec(input.trim());
  if (simple) return { action: simple[1].toLowerCase() as 'leave' | 'list' | 'members' };
  throw new Error('Unknown group command');
}
