'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { GameWatcher } = require('../src/core/watcher');
const { mergeSettings } = require('../src/core/settings');

const GAME = { pid: 4242, name: 'League of Legends.exe', command: 'League of Legends.exe' };
const LAUNCHER = { pid: 11, name: 'LeagueClientUx.exe', command: 'LeagueClientUx.exe' };

/** Watcher wired to a scripted process list and a clock we control. */
function harness({ frames, settings = {}, lcu } = {}) {
  let index = 0;
  let clock = 0;

  const watcher = new GameWatcher({
    settings: mergeSettings({ minGameSeconds: 0, ...settings }),
    platform: 'win32',
    scan: async () => {
      const frame = frames[Math.min(index, frames.length - 1)];
      index += 1;
      if (frame instanceof Error) throw frame;
      return frame;
    },
    now: () => (clock += 1000),
    lcu: lcu || { findCredentials: async () => null, getGameflow: async () => null },
  });

  const events = [];
  watcher.on('game-start', (session) => events.push({ type: 'start', session }));
  watcher.on('game-end', (session) => events.push({ type: 'end', session }));
  watcher.on('scan-error', (error) => events.push({ type: 'error', error }));

  return { watcher, events };
}

test('a game that starts and closes produces one start and one end', async () => {
  const { watcher, events } = harness({
    frames: [[LAUNCHER], [LAUNCHER, GAME], [LAUNCHER, GAME], [LAUNCHER], [LAUNCHER]],
    settings: { missTolerance: 0 },
  });

  for (let i = 0; i < 5; i += 1) await watcher.tick();

  assert.deepStrictEqual(events.map((e) => e.type), ['start', 'end']);
  assert.strictEqual(events[0].session.pid, GAME.pid);
  assert.strictEqual(events[1].session.durationMs, 1000);
  assert.strictEqual(watcher.getStatus().inGame, false);
});

test('closing the launcher alone never ends a game', async () => {
  const { watcher, events } = harness({
    frames: [[LAUNCHER], [LAUNCHER], []],
    settings: { missTolerance: 0 },
  });

  for (let i = 0; i < 3; i += 1) await watcher.tick();

  assert.deepStrictEqual(events, []);
  assert.strictEqual(watcher.getStatus().launcherRunning, false);
});

test('a failed scan is not read as the game closing', async () => {
  const { watcher, events } = harness({
    frames: [[GAME], new Error('tasklist exploded'), [GAME]],
    settings: { missTolerance: 0 },
  });

  await watcher.tick();
  await watcher.tick();
  assert.deepStrictEqual(events.map((e) => e.type), ['start', 'error']);
  assert.strictEqual(watcher.getStatus().inGame, true);
  assert.match(watcher.getStatus().lastError, /exploded/);

  await watcher.tick();
  assert.strictEqual(watcher.getStatus().lastError, null);
  assert.deepStrictEqual(events.map((e) => e.type), ['start', 'error']);
});

test('launcher metadata labels the finished session as TFT', async () => {
  const { watcher, events } = harness({
    frames: [[LAUNCHER, GAME], [LAUNCHER, GAME], [LAUNCHER]],
    settings: { missTolerance: 0 },
    lcu: {
      findCredentials: async () => ({ port: 1, password: 'x' }),
      getGameflow: async () => ({ phase: 'InProgress', queueId: 1100, queueName: 'Ranked Tactics', gameMode: 'TFT', isTFT: true }),
    },
  });

  await watcher.tick();
  await watcher.tick();
  await watcher.tick();

  const ended = events.find((e) => e.type === 'end').session;
  assert.strictEqual(ended.isTFT, true);
  assert.strictEqual(ended.queueName, 'Ranked Tactics');
});

test('the launcher API is not consulted when useLcu is off', async () => {
  let calls = 0;
  const { watcher } = harness({
    frames: [[LAUNCHER, GAME], [LAUNCHER, GAME]],
    settings: { useLcu: false },
    lcu: {
      findCredentials: async () => {
        calls += 1;
        return { port: 1, password: 'x' };
      },
      getGameflow: async () => null,
    },
  });

  await watcher.tick();
  await watcher.tick();
  assert.strictEqual(calls, 0);
});

test('unreachable launcher API leaves the game type unknown', async () => {
  const { watcher, events } = harness({
    frames: [[GAME], [GAME], []],
    settings: { missTolerance: 0 },
    lcu: { findCredentials: async () => null, getGameflow: async () => null },
  });

  await watcher.tick();
  await watcher.tick();
  await watcher.tick();

  const ended = events.find((e) => e.type === 'end').session;
  assert.strictEqual(ended.isTFT, null);
  assert.strictEqual(watcher.getStatus().lcuConnected, false);
});

test('back-to-back games are reported as two sessions', async () => {
  const second = { ...GAME, pid: 5555 };
  const { watcher, events } = harness({
    frames: [[GAME], [second], [second], []],
    settings: { missTolerance: 0 },
  });

  for (let i = 0; i < 4; i += 1) await watcher.tick();

  assert.deepStrictEqual(events.map((e) => e.type), ['start', 'end', 'start', 'end']);
  assert.deepStrictEqual(
    events.filter((e) => e.type === 'end').map((e) => e.session.pid),
    [GAME.pid, second.pid],
  );
});

test('stop() drops a live session without firing reminders', async () => {
  const { watcher, events } = harness({ frames: [[GAME]] });

  watcher.status.watching = true;
  await watcher.tick();
  assert.strictEqual(watcher.getStatus().inGame, true);

  watcher.stop();
  assert.strictEqual(watcher.getStatus().inGame, false);
  assert.deepStrictEqual(events.map((e) => e.type), ['start']);
});

test('start() runs the loop on a timer until stopped', async () => {
  const timers = [];
  const watcher = new GameWatcher({
    settings: mergeSettings({ pollIntervalMs: 1000 }),
    platform: 'win32',
    scan: async () => [GAME],
    lcu: { findCredentials: async () => null, getGameflow: async () => null },
    setTimer: (fn, delay) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimer: () => {},
  });

  const started = [];
  watcher.on('game-start', (s) => started.push(s));

  watcher.start();
  assert.strictEqual(timers[0].delay, 0, 'first scan runs immediately');

  await timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(started.length, 1);
  assert.strictEqual(timers[1].delay, 1000, 'subsequent scans use the poll interval');

  watcher.stop();
  assert.strictEqual(watcher.getStatus().watching, false);
});

test('overlapping ticks are skipped rather than queued', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const watcher = new GameWatcher({
    settings: mergeSettings({}),
    platform: 'win32',
    scan: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return [GAME];
    },
    lcu: { findCredentials: async () => null, getGameflow: async () => null },
  });

  await Promise.all([watcher.tick(), watcher.tick(), watcher.tick()]);
  assert.strictEqual(maxInFlight, 1);
});

test('a scan still in flight when watching stops cannot revive the session', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const watcher = new GameWatcher({
    settings: mergeSettings({}),
    platform: 'win32',
    scan: async () => {
      await gate;
      return [GAME];
    },
    lcu: { findCredentials: async () => null, getGameflow: async () => null },
  });

  const started = [];
  watcher.on('game-start', (session) => started.push(session));

  const inFlight = watcher.tick();
  watcher.stop();
  release();
  await inFlight;

  assert.deepStrictEqual(started, []);
  assert.strictEqual(watcher.getStatus().inGame, false);
});
