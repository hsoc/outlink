export interface MentionNotificationsPort {
  requestPermission(channelName: string, kind?: 'private' | 'nearby'): Promise<boolean>;
  /** Recheck the optional eligibility guard after native permission/channel awaits. */
  show(alert: { id: string; title: string; body: string; channelName: string; kind?: 'private' | 'nearby' }, shouldShow?: () => boolean): Promise<void>;
  clear(kind?: 'private' | 'nearby'): Promise<void>;
}
