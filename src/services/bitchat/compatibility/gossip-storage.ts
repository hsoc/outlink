import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { decodePacket, encodePacket, type BitchatPacket } from '../bitchat-wire';
import { putRecord, readRecords, removeRecord } from './storage';
export async function gossipArchive(onError: (error: unknown) => void = () => {}) {
  const records = await readRecords<{ wire: string }>('gossip', 1000), packets: BitchatPacket[] = [];
  for (const record of records) {
    packets.push(await decodePacket(base64.decode(record.wire), platform.proximityTransport.inflateRawAsync));
  }
  return {
    packets,
    changed(id: string, packet?: BitchatPacket) {
      const operation = packet ? putRecord('gossip', id, { wire: base64.encode(encodePacket(packet)) }) : removeRecord('gossip', id);
      void operation.catch(onError);
    },
  };
}
