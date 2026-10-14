import { hasApnsRelay } from '../apns-relay-eligibility';

jest.mock('../push-api', () => ({ APNS_RELAY_URL: 'wss://relay.outlink.invalid/' }));

describe('APNs inbox prerequisite', () => {
  it.each(['wss://relay.outlink.invalid', 'wss://relay.outlink.invalid/', 'wss://RELAY.OUTLINK.INVALID:443/'])(
    'accepts the normalized deployed relay %s', (relay) => { expect(hasApnsRelay([relay])).toBe(true); },
  );
  it.each(['ws://relay.outlink.invalid/', 'wss://relay.outlink.invalid/other', 'wss://relay.outlink.invalid/?a=1', 'wss://relay.outlink.invalid.evil/', 'not a url'])(
    'rejects a different relay %s', (relay) => { expect(hasApnsRelay([relay])).toBe(false); },
  );
  it('rejects an empty inbox list', () => { expect(hasApnsRelay([])).toBe(false); });
});
