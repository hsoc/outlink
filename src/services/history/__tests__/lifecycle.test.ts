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

function backgroundSetup() {
  let enabled = true, running = false;
  const policy = {
    enabled: () => enabled,
    start: jest.fn(async () => { running = true; }),
    running: jest.fn(async () => running),
    stop: jest.fn(async () => { running = false; }),
    failed: jest.fn(() => { enabled = false; }),
  };
  // Use fresh sessions; do not reuse the disposed fixture's queued shutdown.
  const mesh = { connection: { account: 'device', name: 'Alice' } as { account: string; name: string } | undefined,
    stop: jest.fn(async () => { mesh.connection = undefined; }),
    start: jest.fn(async (account: string, name: string) => { mesh.connection = { account, name }; }) };
  const geo = { connection: { hash: 'ezs42', name: 'Alice', relays: ['wss://example.com'] } as { hash: string; name: string; relays: string[] } | undefined,
    stop: jest.fn(() => { geo.connection = undefined; }), join: jest.fn(async () => {}) };
  return { mesh, geo, policy, enable: (value: boolean) => { enabled = value; }, loseService: () => { running = false; },
    lifecycle: createSessionLifecycle(mesh, geo, policy) };
}
it('keeps mesh and existing relay sessions intact only after foreground service confirmation', async () => {
  const { mesh, geo, policy, lifecycle } = backgroundSetup();
  await lifecycle.change('active'); await lifecycle.change('background'); await lifecycle.change('active');
  expect(policy.start).toHaveBeenCalled(); expect(policy.running).toHaveBeenCalled();
  expect(mesh.stop).not.toHaveBeenCalled(); expect(geo.stop).not.toHaveBeenCalled();
  expect(mesh.start).not.toHaveBeenCalled(); expect(geo.join).not.toHaveBeenCalled();
});
it('stops background connections when the switch or notification Stop disables the policy', async () => {
  const { mesh, geo, policy, lifecycle, enable } = backgroundSetup();
  await lifecycle.change('active'); await lifecycle.change('background');
  enable(false); await lifecycle.change('background');
  expect(mesh.stop).toHaveBeenCalledTimes(1); expect(geo.stop).toHaveBeenCalledTimes(1);
  expect(policy.stop).toHaveBeenCalled();
  await lifecycle.change('active'); expect(mesh.start).toHaveBeenCalledTimes(1);
});
it('fails closed when native startup fails, permissions are denied, or the service disappears', async () => {
  const failed = backgroundSetup(); failed.policy.start.mockRejectedValueOnce(new Error('Denied'));
  await failed.lifecycle.change('active'); await failed.lifecycle.change('background');
  expect(failed.policy.failed).toHaveBeenCalledTimes(1); expect(failed.mesh.stop).toHaveBeenCalled();
  const lost = backgroundSetup(); await lost.lifecycle.change('active'); lost.loseService();
  await lost.lifecycle.change('background');
  expect(lost.policy.failed).toHaveBeenCalledTimes(1); expect(lost.mesh.stop).toHaveBeenCalled();
});
it('never starts a new foreground service from the background', async () => {
  const race = backgroundSetup(); await race.lifecycle.change('background');
  expect(race.policy.start).not.toHaveBeenCalled(); expect(race.mesh.stop).toHaveBeenCalled();
});
it('keeps Location-only public and private connections without starting Bluetooth', async () => {
  const { mesh, geo, policy, lifecycle } = backgroundSetup();
  mesh.connection = undefined;
  await lifecycle.change('active');
  expect(policy.start).toHaveBeenLastCalledWith(false, true);
  await lifecycle.change('background'); await lifecycle.change('active');
  expect(geo.stop).not.toHaveBeenCalled(); expect(geo.join).not.toHaveBeenCalled();
  expect(mesh.start).not.toHaveBeenCalled(); expect(mesh.stop).not.toHaveBeenCalled();
});
it('keeps the remaining transport when leaving one, and releases the service after leaving both', async () => {
  const { mesh, geo, policy, lifecycle } = backgroundSetup();
  await lifecycle.change('active');
  expect(policy.start).toHaveBeenLastCalledWith(true, true);
  mesh.connection = undefined;
  await lifecycle.change('active');
  expect(policy.start).toHaveBeenLastCalledWith(false, true);
  await lifecycle.change('background');
  expect(geo.stop).not.toHaveBeenCalled(); expect(policy.stop).not.toHaveBeenCalled();
  geo.connection = undefined;
  await lifecycle.change('background');
  expect(policy.stop).toHaveBeenCalled();
  const meshOnly = backgroundSetup(); meshOnly.geo.connection = undefined;
  await meshOnly.lifecycle.change('active');
  expect(meshOnly.policy.start).toHaveBeenLastCalledWith(true, false);
  await meshOnly.lifecycle.change('background');
  expect(meshOnly.mesh.stop).not.toHaveBeenCalled();
});
it('pauses and resumes Location-only sessions when disabled, and reports a missing service', async () => {
  const { mesh, geo, lifecycle, enable } = backgroundSetup(); mesh.connection = undefined;
  await lifecycle.change('active'); await lifecycle.change('background');
  enable(false); await lifecycle.change('background');
  expect(geo.stop).toHaveBeenCalledTimes(1);
  await lifecycle.change('active'); expect(geo.join).toHaveBeenCalledTimes(1);
  expect(mesh.start).not.toHaveBeenCalled();
  const lost = backgroundSetup(); lost.mesh.connection = undefined;
  await lost.lifecycle.change('active'); lost.loseService(); await lost.lifecycle.change('background');
  expect(lost.policy.failed).toHaveBeenCalled(); expect(lost.geo.stop).toHaveBeenCalled();
});
it('does not hold the service with no joined sessions', async () => {
  const { mesh, geo, policy, lifecycle } = backgroundSetup();
  mesh.connection = undefined; geo.connection = undefined;
  await lifecycle.change('active');
  expect(policy.start).not.toHaveBeenCalled(); expect(policy.stop).toHaveBeenCalled();
});
it('does not resume paused connections after an identity wipe and releases the keeper on disposal', async () => {
  const { mesh, geo, policy, lifecycle, enable } = backgroundSetup();
  await lifecycle.change('active'); await lifecycle.change('background');
  enable(false); await lifecycle.change('background'); invalidateSessionIntent(); await lifecycle.change('active');
  expect(mesh.start).not.toHaveBeenCalled(); expect(geo.join).not.toHaveBeenCalled();
  lifecycle.dispose(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(policy.stop).toHaveBeenCalled();
});
