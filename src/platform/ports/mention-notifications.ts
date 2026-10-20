export interface MentionNotificationsPort {
  requestPermission(channelName: string): Promise<boolean>;
  show(alert: { id: string; title: string; body: string; channelName: string }): Promise<void>;
  clear(): Promise<void>;
}
