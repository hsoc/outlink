export interface MentionNotificationsPort {
  requestPermission(channelName: string, kind?: 'private'): Promise<boolean>;
  show(alert: { id: string; title: string; body: string; channelName: string; kind?: 'private' }): Promise<void>;
  clear(kind?: 'private'): Promise<void>;
}
