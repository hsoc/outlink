/** @jest-environment node */
import { createSessionLifecycle, invalidateSessionIntent } from '../lifecycle';
function setup() {
  const mesh = { connection: { account: 'device', name: 'Alice' } as { account: string; name: string } | undefined,
    stop: jest.fn(async () => { mesh.connection = undefined; }),
    start: jest.fn(async (account: string, name: string) => { mesh.connection = { account, name }; }) };
  const geo = { connection: { hash: 'ezs42', name: 'Alice', relays: ['wss://example.com'] } as { hash: string; name: string; relays: string[] } | undefined,
    stop: jest.fn(() => { geo.connection = undefined; }),
    join: jest.fn(async (hash: string, name: string, relays: string[]) => { geo.connection = { hash, name, relays }; }) };
  return { mesh, geo, lifecycle: createSessionLifecycle(mesh, geo) };
}
it('ignores permission-dialog inactivity, pauses once and reconnects once with the same settings', async () => {
  const { mesh, geo, lifecycle } = setup();
  await lifecycle.change('inactive'); await lifecycle.change('active');
  expect(mesh.stop).not.toHaveBeenCalled(); expect(geo.stop).not.toHaveBeenCalled();
  await lifecycle.change('background'); await lifecycle.change('background');
  expect(mesh.stop).toHaveBeenCalledTimes(1);
  await lifecycle.change('active'); await lifecycle.change('active');
  expect(mesh.start).toHaveBeenCalledTimes(1);
  expect(geo.join).toHaveBeenCalledWith('ezs42', 'Alice', ['wss://example.com']);
});
it('serializes rapid background/foreground events and does not rejoin explicitly left sessions', async () => {
  const { mesh, geo, lifecycle } = setup();
  await Promise.all([lifecycle.change('background'), lifecycle.change('active'), lifecycle.change('background'), lifecycle.change('active')]);
  expect(mesh.start).toHaveBeenCalledTimes(2);
  await mesh.stop(); geo.stop();
  await lifecycle.change('background'); await lifecycle.change('active');
  expect(mesh.start).toHaveBeenCalledTimes(2); expect(geo.join).toHaveBeenCalledTimes(2);
});
it('does not reconnect after the root unmounts', async () => {
  const { mesh, lifecycle } = setup();
  await lifecycle.change('background'); lifecycle.dispose(); await lifecycle.change('active');
  expect(mesh.start).not.toHaveBeenCalled();
});

it('does not resurrect the previous identity after an explicit wipe while backgrounded', async () => {
  const { mesh, geo, lifecycle } = setup();
  await lifecycle.change('background'); invalidateSessionIntent(); await lifecycle.change('active');
  expect(mesh.start).not.toHaveBeenCalled(); expect(geo.join).not.toHaveBeenCalled();
});
