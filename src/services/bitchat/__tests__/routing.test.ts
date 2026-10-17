/** @jest-environment node */
import { createHash } from 'node:crypto';
import { MeshRouting, nextRoute, selectFanout, relayTiming } from '../compatibility/routing';
import type { BitchatPacket } from '../bitchat-wire';
const id = (value: number) => value.toString(16).padStart(16, '0');
const packet: BitchatPacket = { version: 2, type: 17, ttl: 7, timestamp: 1, sender: id(1), recipient: id(4), route: [id(2), id(3)], payload: new Uint8Array() };
it('routes only across fresh, mutually claimed v2 edges, with at most four intermediates', () => {
  const graph = new MeshRouting();
  graph.update(id(1), [id(2)], 2, 1000); graph.update(id(2), [id(1), id(3)], 2, 1000);
  graph.update(id(3), [id(2), id(4)], 1, 1000); graph.update(id(4), [id(3)], 2, 1000);
  expect(graph.route(id(1), id(4), 1000)).toBeUndefined(); graph.observe(id(3), 2);
  expect(graph.route(id(1), id(4), 1000)).toEqual([id(2), id(3)]);
  expect(graph.route(id(1), id(4), 61000)).toBeUndefined();
  graph.update(id(4), [], 2, 1000); expect(graph.route(id(1), id(4), 1000)).toBeUndefined();
  graph.clear(); for (let i = 1; i <= 7; i++) graph.update(id(i), [i > 1 ? id(i - 1) : id(i), id(i + 1)], 2, 1000);
  expect(graph.route(id(1), id(6), 1000)).toHaveLength(4); expect(graph.route(id(1), id(7), 1000)).toBeUndefined();
});
it('suppresses an unconfirmed route, retains its earliest deadline, and recovers after cooldown', () => {
  const graph = new MeshRouting(); graph.routed(id(4), 1000); graph.routed(id(4), 5000);
  expect(graph.canRoute(id(4), 10000)).toBe(true); expect(graph.canRoute(id(4), 11001)).toBe(false);
  graph.confirmed(id(4)); expect(graph.canRoute(id(4), 20000)).toBe(false); expect(graph.canRoute(id(4), 71001)).toBe(true);
  graph.routed(id(4), 72000); graph.confirmed(id(4)); expect(graph.canRoute(id(4), 100000)).toBe(true);
});
it('follows routes at first/intermediate/final hops and never forwards link-local sync or local deliveries', () => {
  expect(nextRoute(packet, id(8))).toBe(id(2)); expect(nextRoute(packet, id(2))).toBe(id(3)); expect(nextRoute(packet, id(3))).toBe(id(4));
  expect(nextRoute(packet, id(4))).toBe('drop'); expect(nextRoute({ ...packet, type: 33 }, id(2))).toBe('drop');
  expect(nextRoute({ ...packet, ttl: 1 }, id(2))).toBe('drop'); expect(nextRoute({ ...packet, route: [] }, id(2))).toBeUndefined();
});
it('subsets each role deterministically using independently computed SHA-256 scores and preserves control/directed fanout', () => {
  const links = Array.from({ length: 8 }, (_, i) => `c:${i}`), pub = { ...packet, type: 2, recipient: undefined };
  const expected = links.map(id => ({ id, score: createHash('sha256').update('message::' + id).digest('hex') })).sort((a, b) => a.score.localeCompare(b.score)).slice(0, 4).map(entry => entry.id);
  expect(selectFanout(links, pub, 'message')).toEqual(expected);
  expect(selectFanout([...links].reverse(), pub, 'message')).toEqual(expected);
  expect(selectFanout(links, packet, 'message')).toEqual(links);
  for (const type of [1, 32, 33]) expect(selectFanout(links, { ...pub, type }, 'message')).toEqual(links);
});
it('uses upstream TTL and jitter classes and suppresses exhausted/local-sync forwarding', () => {
  expect(relayTiming({ ...packet, ttl: 1 }, 2, 0)).toBeUndefined(); expect(relayTiming({ ...packet, type: 33 }, 2, 0)).toBeUndefined();
  expect(relayTiming({ ...packet, type: 16 }, 8, 0)).toEqual({ ttl: 6, delay: 10 });
  expect(relayTiming(packet, 8, 0)).toEqual({ ttl: 6, delay: 20 });
  expect(relayTiming({ ...packet, type: 32, recipient: undefined }, 8, 0)).toEqual({ ttl: 4, delay: 8 });
  expect(relayTiming({ ...packet, type: 2, recipient: undefined }, 3, 0)).toEqual({ ttl: 5, delay: 60 });
});
