'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Notifier } = require('../src/main/notifier');

/** Collects notifications instead of calling into Electron, with manual timers. */
function harness() {
  const shown = [];
  const timers = new Map();
  let nextId = 0;

  const notifier = new Notifier({
    createNotification: (options) => {
      const record = { ...options, wasShown: false };
      return {
        show() {
          record.wasShown = true;
          shown.push(record);
        },
      };
    },
    setTimer: (fn, delay) => {
      nextId += 1;
      timers.set(nextId, { fn, delay });
      return nextId;
    },
    clearTimer: (id) => timers.delete(id),
  });

  return { notifier, shown, timers, runTimers: () => [...timers.values()].forEach((t) => t.fn()) };
}

test('zero-delay notifications show immediately', () => {
  const { notifier, shown } = harness();
  const count = notifier.schedule([
    { id: '1', title: 'League game finished', body: 'Stretch', delayMs: 0 },
    { id: '2', title: 'League game finished', body: 'Water', delayMs: 0 },
  ]);

  assert.strictEqual(count, 2);
  assert.deepStrictEqual(shown.map((n) => n.body), ['Stretch', 'Water']);
  assert.strictEqual(notifier.pendingCount, 0);
});

test('delayed notifications wait for their timer', () => {
  const { notifier, shown, timers, runTimers } = harness();
  notifier.schedule([{ id: 'late', title: 'T', body: 'Eyes', delayMs: 30000 }]);

  assert.deepStrictEqual(shown, []);
  assert.strictEqual(notifier.pendingCount, 1);
  assert.strictEqual([...timers.values()][0].delay, 30000);

  runTimers();
  assert.deepStrictEqual(shown.map((n) => n.body), ['Eyes']);
  assert.strictEqual(notifier.pendingCount, 0);
});

test('cancelPending drops queued reminders when the next game starts', () => {
  const { notifier, shown, runTimers } = harness();
  notifier.schedule([
    { id: 'now', title: 'T', body: 'Now', delayMs: 0 },
    { id: 'later', title: 'T', body: 'Later', delayMs: 60000 },
  ]);

  assert.strictEqual(notifier.cancelPending(), 1);
  runTimers();
  assert.deepStrictEqual(shown.map((n) => n.body), ['Now'], 'the delayed one never fires');
});

test('the silent flag is passed through to the notification', () => {
  const { notifier, shown } = harness();
  notifier.schedule([{ id: '1', title: 'T', body: 'B', delayMs: 0 }], { silent: true });
  assert.strictEqual(shown[0].silent, true);
});

test('a throwing notification backend does not break the caller', () => {
  const notifier = new Notifier({
    createNotification: () => {
      throw new Error('no notification service');
    },
  });
  assert.doesNotThrow(() => notifier.schedule([{ id: '1', title: 'T', body: 'B', delayMs: 0 }]));
});

test('onShow reports each delivered notification', () => {
  const delivered = [];
  const notifier = new Notifier({
    createNotification: () => ({ show() {} }),
    onShow: (n) => delivered.push(n.id),
  });
  notifier.schedule([{ id: 'a', title: 'T', body: 'B', delayMs: 0 }]);
  assert.deepStrictEqual(delivered, ['a']);
});
