'use strict';

const test = require('node:test');
const assert = require('node:assert');
const planner = require('../src/core/reminderPlanner');
const { mergeSettings } = require('../src/core/settings');

function settingsWith(overrides = {}, reminders) {
  return mergeSettings({
    minGameSeconds: 60,
    reminders: reminders || [
      { id: 'a', text: 'Stretch', enabled: true, delaySeconds: 0, appliesTo: 'any', everyNGames: 1 },
    ],
    ...overrides,
  });
}

function session(overrides = {}) {
  return {
    id: 'g-1',
    pid: 1,
    startedAt: 0,
    endedAt: 1800000,
    durationMs: 1800000,
    queueName: 'Ranked Solo/Duo',
    gameMode: 'CLASSIC',
    isTFT: false,
    ...overrides,
  };
}

test('a finished game fires the summary plus each enabled reminder', () => {
  const plan = planner.planNotifications({ session: session(), settings: settingsWith(), gamesPlayed: 1 });

  assert.strictEqual(plan.skippedReason, null);
  assert.deepStrictEqual(plan.notifications.map((n) => n.kind), ['summary', 'reminder']);
  assert.strictEqual(plan.notifications[0].title, 'League game finished');
  assert.strictEqual(plan.notifications[0].body, 'Ranked Solo/Duo · 30m 00s');
  assert.strictEqual(plan.notifications[1].body, 'Stretch');
});

test('games shorter than minGameSeconds are ignored', () => {
  const plan = planner.planNotifications({
    session: session({ durationMs: 20000 }),
    settings: settingsWith(),
  });
  assert.strictEqual(plan.skippedReason, 'too-short');
  assert.deepStrictEqual(plan.notifications, []);
});

test('a muted game type produces no notifications', () => {
  const tft = session({ isTFT: true, queueName: 'Ranked Tactics' });
  const plan = planner.planNotifications({ session: tft, settings: settingsWith({ notifyForTFT: false }) });
  assert.strictEqual(plan.skippedReason, 'game-type-muted');

  const allowed = planner.planNotifications({ session: tft, settings: settingsWith({ notifyForLoL: false }) });
  assert.strictEqual(allowed.skippedReason, null);
  assert.strictEqual(allowed.notifications[0].title, 'TFT game finished');
});

test('an unknown game type still notifies while either type is enabled', () => {
  const unknown = session({ isTFT: null, queueName: null });

  const plan = planner.planNotifications({ session: unknown, settings: settingsWith({ notifyForLoL: false }) });
  assert.strictEqual(plan.skippedReason, null);
  assert.strictEqual(plan.notifications[0].title, 'Game finished');
  assert.strictEqual(plan.notifications[0].body, '30m 00s');

  const muted = planner.planNotifications({
    session: unknown,
    settings: settingsWith({ notifyForLoL: false, notifyForTFT: false }),
  });
  assert.strictEqual(muted.skippedReason, 'game-type-muted');
});

test('type-specific reminders only fire for their own game type', () => {
  const reminders = [
    { id: 'tft', text: 'Check your ranked LP', enabled: true, appliesTo: 'tft', delaySeconds: 0, everyNGames: 1 },
    { id: 'lol', text: 'Review that last teamfight', enabled: true, appliesTo: 'lol', delaySeconds: 0, everyNGames: 1 },
  ];
  const settings = settingsWith({ showGameSummary: false }, reminders);

  const lolPlan = planner.planNotifications({ session: session({ isTFT: false }), settings });
  assert.deepStrictEqual(lolPlan.notifications.map((n) => n.reminderId), ['lol']);

  const tftPlan = planner.planNotifications({ session: session({ isTFT: true }), settings });
  assert.deepStrictEqual(tftPlan.notifications.map((n) => n.reminderId), ['tft']);

  // Without the launcher API the type is unknown, so neither should guess.
  const unknownPlan = planner.planNotifications({ session: session({ isTFT: null }), settings });
  assert.strictEqual(unknownPlan.skippedReason, 'no-matching-reminders');
});

test('everyNGames throttles a reminder to its cadence', () => {
  const reminders = [
    { id: 'break', text: 'Take a long break', enabled: true, appliesTo: 'any', delaySeconds: 0, everyNGames: 3 },
  ];
  const settings = settingsWith({ showGameSummary: false }, reminders);

  const fired = [1, 2, 3, 4, 5, 6].map(
    (gamesPlayed) => planner.planNotifications({ session: session(), settings, gamesPlayed }).notifications.length,
  );
  assert.deepStrictEqual(fired, [0, 0, 1, 0, 0, 1]);
});

test('disabled reminders are skipped', () => {
  const reminders = [{ id: 'off', text: 'Nope', enabled: false, appliesTo: 'any', delaySeconds: 0, everyNGames: 1 }];
  const plan = planner.planNotifications({
    session: session(),
    settings: settingsWith({ showGameSummary: false }, reminders),
  });
  assert.strictEqual(plan.skippedReason, 'no-matching-reminders');
});

test('delaySeconds becomes a delay in milliseconds', () => {
  const reminders = [
    { id: 'late', text: 'Eyes', enabled: true, appliesTo: 'any', delaySeconds: 90, everyNGames: 1 },
  ];
  const plan = planner.planNotifications({
    session: session(),
    settings: settingsWith({ showGameSummary: false }, reminders),
  });
  assert.strictEqual(plan.notifications[0].delayMs, 90000);
});

test('formatDuration covers seconds, minutes and hours', () => {
  assert.strictEqual(planner.formatDuration(0), '0m 00s');
  assert.strictEqual(planner.formatDuration(9000), '0m 09s');
  assert.strictEqual(planner.formatDuration(1932000), '32m 12s');
  assert.strictEqual(planner.formatDuration(3900000), '1h 5m');
});
