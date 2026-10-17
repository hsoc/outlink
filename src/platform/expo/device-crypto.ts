import { randomUUID } from 'expo-crypto';
import type { DeviceCryptoPort } from '../ports/device-crypto';
export const deviceCryptoAdapter: DeviceCryptoPort = { randomUUID: async () => randomUUID() };
