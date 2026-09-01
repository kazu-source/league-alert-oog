'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const lcu = require('../src/core/lcu');

test('parseLockfile reads port and password', () => {
  assert.deepStrictEqual(lcu.parseLockfile('LeagueClient:19104:52123:Xy-Z_123:https\n'), {
    port: 52123,
    password: 'Xy-Z_123',
    source: 'lockfile',
  });
});

test('parseLockfile rejects truncated or malformed contents', () => {
  assert.strictEqual(lcu.parseLockfile('LeagueClient:19104'), null);
  assert.strictEqual(lcu.parseLockfile('LeagueClient:19104:notaport:pw:https'), null);
  assert.strictEqual(lcu.parseLockfile(''), null);
});

test('parseCommandLineCredentials extracts the launcher port and token', () => {
  const line =
    '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" --app-port=52123 --remoting-auth-token=abc_DEF-1 --install-directory=x';
  assert.deepStrictEqual(lcu.parseCommandLineCredentials(line), {
    port: 52123,
    password: 'abc_DEF-1',
    source: 'command-line',
  });
});

test('parseCommandLineCredentials handles quoted args and other processes', () => {
  const output = [
    '/usr/sbin/cfprefsd',
    '/Applications/League of Legends.app/Contents/LoL/LeagueClientUx --app-port="52999" --remoting-auth-token="tok123"',
  ].join('\n');
  assert.deepStrictEqual(lcu.parseCommandLineCredentials(output), {
    port: 52999,
    password: 'tok123',
    source: 'command-line',
  });
});

test('parseCommandLineCredentials returns null when the launcher is absent', () => {
  assert.strictEqual(lcu.parseCommandLineCredentials('/usr/sbin/cfprefsd\n/bin/zsh'), null);
});

test('findCredentials falls back to the lockfile when the process query fails', async () => {
  const credentials = await lcu.findCredentials({
    platform: 'win32',
    run: async () => {
      throw new Error('powershell missing');
    },
    readFile: async (file) => {
      if (!file.endsWith('lockfile')) throw new Error('ENOENT');
      return 'LeagueClient:1:2222:pw:https';
    },
    lockfilePaths: ['C:\\Riot Games\\League of Legends\\lockfile'],
  });
  assert.deepStrictEqual(credentials, { port: 2222, password: 'pw', source: 'lockfile' });
});

test('findCredentials returns null when nothing is running', async () => {
  const credentials = await lcu.findCredentials({
    platform: 'darwin',
    run: async () => '/bin/zsh',
    readFile: async () => {
      throw new Error('ENOENT');
    },
    lockfilePaths: ['/nope/lockfile'],
  });
  assert.strictEqual(credentials, null);
});

test('normalizeGameflow flags a TFT queue', () => {
  const state = lcu.normalizeGameflow({
    phase: 'InProgress',
    gameData: { queue: { id: 1100, name: 'Ranked Tactics', gameMode: 'TFT' } },
  });
  assert.deepStrictEqual(state, {
    phase: 'InProgress',
    queueId: 1100,
    queueName: 'Ranked Tactics',
    gameMode: 'TFT',
    isTFT: true,
  });
});

test('normalizeGameflow flags a Summoners Rift queue as not-TFT', () => {
  const state = lcu.normalizeGameflow({
    phase: 'InProgress',
    gameData: { queue: { id: 420, name: 'Ranked Solo/Duo', gameMode: 'CLASSIC' } },
  });
  assert.strictEqual(state.isTFT, false);
  assert.strictEqual(state.queueName, 'Ranked Solo/Duo');
});

test('normalizeGameflow falls back to queue id when gameMode is missing', () => {
  assert.strictEqual(lcu.normalizeGameflow({ gameData: { queue: { id: 1090 } } }).isTFT, true);
  assert.strictEqual(lcu.normalizeGameflow({ gameData: { queue: { id: 450 } } }).isTFT, false);
});

test('normalizeGameflow leaves the type unknown with no queue data', () => {
  const state = lcu.normalizeGameflow({ phase: 'None' });
  assert.strictEqual(state.isTFT, null);
  assert.strictEqual(state.queueName, null);
  assert.strictEqual(lcu.normalizeGameflow(null), null);
});

test('lcuRequest sends basic auth and parses the JSON body', async () => {
  const seen = {};
  const server = http.createServer((req, res) => {
    seen.url = req.url;
    seen.auth = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ phase: 'InProgress' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const body = await lcu.lcuRequest(
      { port: server.address().port, password: 'secret' },
      '/lol-gameflow/v1/session',
      { request: http.request },
    );
    assert.deepStrictEqual(body, { phase: 'InProgress' });
    assert.strictEqual(seen.url, '/lol-gameflow/v1/session');
    assert.strictEqual(seen.auth, `Basic ${Buffer.from('riot:secret').toString('base64')}`);
  } finally {
    server.close();
  }
});

test('lcuRequest rejects on a non-2xx response', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await assert.rejects(
      () => lcu.lcuRequest({ port: server.address().port, password: 'bad' }, '/x', { request: http.request }),
      /HTTP 401/,
    );
  } finally {
    server.close();
  }
});

test('getGameflow swallows transport errors and reports null', async () => {
  // Port 1 is not listening, so the connection is refused.
  assert.strictEqual(await lcu.getGameflow({ port: 1, password: 'x' }, { request: http.request }), null);
  assert.strictEqual(await lcu.getGameflow(null), null);
});
