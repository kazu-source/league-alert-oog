'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { SessionTracker } = require('../src/core/sessionTracker');

const proc = (pid = 1) => ({ pid, name: 'League of Legends.exe' });

test('emits start when the game client appears and end when it goes away', () => {
  const tracker = new SessionTracker({ missTolerance: 0 });

  assert.deepStrictEqual(tracker.observe(null, 0), []);

  const started = tracker.observe(proc(), 1000);
  assert.strictEqual(started.length, 1);
  assert.strictEqual(started[0].type, 'start');
  assert.strictEqual(tracker.isInGame, true);

  assert.deepStrictEqual(tracker.observe(proc(), 5000), []);

  const ended = tracker.observe(null, 9000);
  assert.strictEqual(ended.length, 1);
  assert.strictEqual(ended[0].type, 'end');
  assert.strictEqual(ended[0].session.durationMs, 4000);
  assert.strictEqual(tracker.isInGame, false);
});

test('missTolerance rides out a single missed scan', () => {
  const tracker = new SessionTracker({ missTolerance: 1 });
  tracker.observe(proc(), 0);

  assert.deepStrictEqual(tracker.observe(null, 1000), [], 'first miss is tolerated');
  assert.strictEqual(tracker.isInGame, true);

  assert.deepStrictEqual(tracker.observe(proc(), 2000), [], 'process came back');
  assert.deepStrictEqual(tracker.observe(null, 3000), []);

  const ended = tracker.observe(null, 4000);
  assert.strictEqual(ended[0].type, 'end');
  // Ends when it was last seen (2000), not when tolerance ran out (4000).
  assert.strictEqual(ended[0].session.durationMs, 2000);
});

test('a new pid closes the old session and opens a new one', () => {
  const tracker = new SessionTracker({ missTolerance: 5 });
  tracker.observe(proc(11), 0);

  const events = tracker.observe(proc(22), 60000);
  assert.deepStrictEqual(events.map((e) => e.type), ['end', 'start']);
  assert.strictEqual(events[0].session.pid, 11);
  assert.strictEqual(events[1].session.pid, 22);
  assert.strictEqual(tracker.getSession().pid, 22);
});

test('repeated absence after the session ends produces nothing', () => {
  const tracker = new SessionTracker({ missTolerance: 0 });
  tracker.observe(proc(), 0);
  tracker.observe(null, 1000);
  assert.deepStrictEqual(tracker.observe(null, 2000), []);
  assert.deepStrictEqual(tracker.observe(null, 3000), []);
});

test('annotate merges launcher metadata and ignores nulls', () => {
  const tracker = new SessionTracker();
  tracker.observe(proc(), 0);

  tracker.annotate({ queueName: 'Ranked Tactics', isTFT: true, gameMode: 'TFT' });
  tracker.annotate({ queueName: null, isTFT: null });

  const session = tracker.getSession();
  assert.strictEqual(session.queueName, 'Ranked Tactics');
  assert.strictEqual(session.isTFT, true);
});

test('annotate is a no-op with no live session', () => {
  const tracker = new SessionTracker();
  tracker.annotate({ queueName: 'ARAM' });
  assert.strictEqual(tracker.getSession(), null);
});

test('flush closes a live session at its last-seen time', () => {
  const tracker = new SessionTracker();
  tracker.observe(proc(), 0);
  tracker.observe(proc(), 7000);

  const events = tracker.flush(99999);
  assert.strictEqual(events[0].session.durationMs, 7000);
  assert.deepStrictEqual(tracker.flush(99999), []);
});

test('getSession returns a copy, not the live object', () => {
  const tracker = new SessionTracker();
  tracker.observe(proc(), 0);
  tracker.getSession().queueName = 'mutated';
  assert.strictEqual(tracker.getSession().queueName, null);
});
