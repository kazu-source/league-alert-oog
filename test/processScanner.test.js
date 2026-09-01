'use strict';

const test = require('node:test');
const assert = require('node:assert');
const scanner = require('../src/core/processScanner');

test('parseTasklist reads name and pid from quoted CSV', () => {
  const stdout = [
    '"System Idle Process","0","Services","0","8 K"',
    '"League of Legends.exe","24680","Console","1","1,234,567 K"',
    '"LeagueClientUx.exe","1357","Console","1","456 K"',
  ].join('\r\n');

  const records = scanner.parseTasklist(stdout);
  assert.deepStrictEqual(records[1], {
    pid: 24680,
    name: 'League of Legends.exe',
    command: 'League of Legends.exe',
  });
  assert.strictEqual(records.length, 3);
});

test('parseTasklist ignores blank and malformed lines', () => {
  const records = scanner.parseTasklist('\r\n"only-one-field"\r\n"name","not-a-pid"\r\n');
  assert.deepStrictEqual(records, []);
});

test('parseCsvLine unescapes doubled quotes', () => {
  assert.deepStrictEqual(scanner.parseCsvLine('"a""b","2"'), ['a"b', '2']);
});

test('parsePsOutput keeps spaces in executable paths', () => {
  const stdout = [
    '  501 /usr/sbin/cfprefsd',
    '  777 /Applications/League of Legends.app/Contents/LoL/Game/League of Legends.app/Contents/MacOS/League of Legends',
  ].join('\n');

  const records = scanner.parsePsOutput(stdout);
  assert.strictEqual(records[1].pid, 777);
  assert.strictEqual(records[1].name, 'League');
  assert.ok(records[1].command.endsWith('MacOS/League of Legends'));
});

test('scanProcesses dispatches the platform command', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, args]);
    return '"League of Legends.exe","42","Console","1","1 K"';
  };

  const records = await scanner.scanProcesses({ platform: 'win32', run });
  assert.deepStrictEqual(calls, [['tasklist', ['/fo', 'csv', '/nh']]]);
  assert.strictEqual(records[0].pid, 42);
});

test('scanProcesses rejects on an unsupported platform', async () => {
  await assert.rejects(() => scanner.scanProcesses({ platform: 'aix' }), /not supported/);
});
