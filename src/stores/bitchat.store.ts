import { useStore } from 'zustand';
import { bitchatSessionStore, type BitchatState } from '@/services/bitchat/bitchat.service';
export const useBitchatStore = <T,>(selector: (state: BitchatState) => T): T => useStore(bitchatSessionStore, selector);
