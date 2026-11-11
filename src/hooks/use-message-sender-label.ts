import { useCallback, useMemo, useRef } from 'react';
import type { ViewToken } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { displayNickname, nicknameKey } from '@/lib/nicknames';
import { platform } from '@/platform';
import { retainedSenderLabel, retainSenderLabels } from '@/services/history/history';

const viewabilityConfig = { itemVisiblePercentThreshold: 1 };

type Message = { name: string; timestamp: number; senderLabel?: string };
type Sender<T> = (message: T) => { id: string; identity: string };

export function useMessageSenderLabel<T extends Message>(
  room: string, messages: T[], sender: Sender<T>, collisions: ReadonlyMap<string, ReadonlySet<string>>, showing: boolean, peer?: string,
) {
  const keyExtractor = useCallback((message: T) => JSON.stringify([room, sender(message).id, message.timestamp]), [room, sender]);
  const visibleKeys = useRef<string[]>([]);
  const retainVisible = useRef<() => void>(undefined);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
    visibleKeys.current = viewableItems.map(token => token.key);
    retainVisible.current?.();
  }, []);
  const qualified = useMemo(() => {
    const labels = new Map<string, { label: string; timestamp: number; id: string }>();
    if (showing && collisions.size) {
      for (const message of messages) {
        if (message.senderLabel) continue;
        const { id, identity } = sender(message);
        if (!collisions.get(nicknameKey(message.name))?.has(identity)) continue;
        const label = displayNickname(message.name, identity, true);
        if (label !== displayNickname(message.name, identity)) labels.set(keyExtractor(message), { label, timestamp: message.timestamp, id });
      }
    }
    return labels;
  }, [messages, sender, collisions, showing, keyExtractor]);

  useFocusEffect(useCallback(() => {
    if (!qualified.size) return;
    const retain = () => {
      if (platform.appState.currentState() !== 'active') return;
      const seen = new Map<string, { label: string; timestamp: number }>();
      for (const key of visibleKeys.current) {
        const entry = qualified.get(key);
        if (entry) seen.set(entry.id, entry);
      }
      if (seen.size) retainSenderLabels(room, seen, peer);
    };
    retainVisible.current = retain;
    retain();
    const remove = platform.appState.addChangeListener(retain);
    return () => { retainVisible.current = undefined; remove(); };
  }, [room, qualified, peer]));

  function labelFor(message: T) {
    const { id, identity } = sender(message);
    return message.senderLabel ?? retainedSenderLabel(room, id, message.timestamp)
      ?? qualified.get(keyExtractor(message))?.label ?? displayNickname(message.name, identity);
  }
  return { labelFor, onViewableItemsChanged, viewabilityConfig, keyExtractor };
}
