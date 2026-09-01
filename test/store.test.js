'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store, MAX_HISTORY } = require('../src/main/store');

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'league-alert-test-'));
  return { dir, store: new Store({ dir }) };
}

const session = (id) => ({
  id,
  startedAt: 0,
  endedAt: 60000,
  durationMs: 60000,
  queueName: 'ARAM',
  isTFT: false,
});

test('a missing config file loads defaults', async () => {
  const { store } = await tempStore();
  await store.load();
  assert.strictEqual(store.getSettings().pollIntervalMs, 4000);
  assert.deepStrictEqual(store.getHistory(), []);
});

test('settings round-trip through the file', async () => {
  const { dir, store } = await tempStore();
  await store.load();
  await store.saveSettings({ pollIntervalMs: 8000, playSound: false });

  const reopened = new Store({ dir });
  await reopened.load();
  assert.strictEqual(reopened.getSettings().pollIntervalMs, 8000);
  assert.strictEqual(reopened.getSettings().playSound, false);
});

test('a corrupt config file falls back to defaults instead of throwing', async () => {
  const { dir, store } = await tempStore();
  await fs.writeFile(path.join(dir, 'config.json'), '{not json', 'utf8');
  await store.load();
  assert.strictEqual(store.getSettings().watchEnabled, true);
});

test('saved settings are validated on the way in', async () => {
  const { store } = await tempStore();
  await store.load();
  const saved = await store.saveSettings({ pollIntervalMs: 5 });
  assert.strictEqual(saved.pollIntervalMs, 1000);
});

test('recordGame counts games and keeps newest history first', async () => {
  const { store } = await tempStore();
  await store.load();

  assert.strictEqual(await store.recordGame(session('a')), 1);
  assert.strictEqual(await store.recordGame(session('b')), 2);
  assert.deepStrictEqual(store.getHistory().map((h) => h.id), ['b', 'a']);
  assert.strictEqual(store.getStats().gamesPlayed, 2);
});

test('history is capped and the game counter survives a reload', async () => {
  const { dir, store } = await tempStore();
  await store.load();
  for (let i = 0; i < MAX_HISTORY + 5; i += 1) await store.recordGame(session(`g${i}`));

  const reopened = new Store({ dir });
  await reopened.load();
  assert.strictEqual(reopened.getHistory().length, MAX_HISTORY);
  assert.strictEqual(reopened.getStats().gamesPlayed, MAX_HISTORY + 5);
});

test('concurrent writes do not corrupt the file', async () => {
  const { dir, store } = await tempStore();
  await store.load();

  await Promise.all([
    store.saveSettings({ pollIntervalMs: 2000 }),
    store.recordGame(session('x')),
    store.saveSettings({ minGameSeconds: 30 }),
  ]);

  const reopened = new Store({ dir });
  await reopened.load();
  assert.strictEqual(reopened.getSettings().minGameSeconds, 30);
  assert.strictEqual(reopened.getHistory().length, 1);
});

test('clearHistory empties the log but keeps the counter', async () => {
  const { store } = await tempStore();
  await store.load();
  await store.recordGame(session('a'));
  await store.clearHistory();
  assert.deepStrictEqual(store.getHistory(), []);
  assert.strictEqual(store.getStats().gamesPlayed, 1);
});
