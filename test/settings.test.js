'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { mergeSettings, DEFAULT_SETTINGS } = require('../src/core/settings');

test('missing config yields the defaults', () => {
  assert.deepStrictEqual(mergeSettings(undefined).pollIntervalMs, DEFAULT_SETTINGS.pollIntervalMs);
  assert.strictEqual(mergeSettings(null).reminders.length, DEFAULT_SETTINGS.reminders.length);
});

test('out-of-range numbers are clamped instead of rejected', () => {
  const settings = mergeSettings({ pollIntervalMs: 5, missTolerance: 999, minGameSeconds: -10 });
  assert.strictEqual(settings.pollIntervalMs, 1000);
  assert.strictEqual(settings.missTolerance, 10);
  assert.strictEqual(settings.minGameSeconds, 0);
});

test('non-numeric values fall back to defaults', () => {
  const settings = mergeSettings({ pollIntervalMs: 'soon', minGameSeconds: null });
  assert.strictEqual(settings.pollIntervalMs, DEFAULT_SETTINGS.pollIntervalMs);
  assert.strictEqual(settings.minGameSeconds, DEFAULT_SETTINGS.minGameSeconds);
});

test('reminders without text are dropped and ids are made unique', () => {
  const settings = mergeSettings({
    reminders: [
      { id: 'dup', text: 'First' },
      { id: 'dup', text: 'Second' },
      { text: '   ' },
      { enabled: true },
      'not-an-object',
    ],
  });

  assert.strictEqual(settings.reminders.length, 2);
  assert.notStrictEqual(settings.reminders[0].id, settings.reminders[1].id);
  assert.deepStrictEqual(settings.reminders.map((r) => r.text), ['First', 'Second']);
});

test('an unknown appliesTo value falls back to "any"', () => {
  const settings = mergeSettings({ reminders: [{ text: 'x', appliesTo: 'valorant' }] });
  assert.strictEqual(settings.reminders[0].appliesTo, 'any');
});

test('a non-array reminders value restores the default set', () => {
  assert.strictEqual(mergeSettings({ reminders: 'nope' }).reminders.length, DEFAULT_SETTINGS.reminders.length);
});

test('extra process names are trimmed, filtered and capped', () => {
  const settings = mergeSettings({
    extraGameProcessNames: ['  custom.exe  ', '', 42, ...Array.from({ length: 30 }, (_, i) => `p${i}.exe`)],
  });
  assert.strictEqual(settings.extraGameProcessNames[0], 'custom.exe');
  assert.strictEqual(settings.extraGameProcessNames.length, 20);
});

test('booleans survive round-tripping and reject junk', () => {
  assert.strictEqual(mergeSettings({ playSound: false }).playSound, false);
  assert.strictEqual(mergeSettings({ playSound: 'false' }).playSound, DEFAULT_SETTINGS.playSound);
});

test('merging is idempotent', () => {
  const once = mergeSettings({ pollIntervalMs: 7000 });
  assert.deepStrictEqual(mergeSettings(once), once);
});
