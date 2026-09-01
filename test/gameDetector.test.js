'use strict';

const test = require('node:test');
const assert = require('node:assert');
const detector = require('../src/core/gameDetector');

const win = (name, pid) => ({ pid, name, command: name });
const mac = (command, pid) => ({ pid, name: command.split('/').pop(), command });

test('windows: the game client is detected, the launcher is not', () => {
  const records = [
    win('LeagueClient.exe', 100),
    win('LeagueClientUx.exe', 101),
    win('RiotClientServices.exe', 102),
    win('League of Legends.exe', 200),
  ];

  const game = detector.findGameProcess(records, 'win32');
  assert.strictEqual(game.pid, 200);
  assert.strictEqual(detector.findLauncherProcess(records, 'win32').pid, 100);
});

test('windows: closing everything but the launcher leaves no game process', () => {
  const records = [win('LeagueClient.exe', 100), win('LeagueClientUx.exe', 101)];
  assert.strictEqual(detector.findGameProcess(records, 'win32'), null);
  assert.ok(detector.findLauncherProcess(records, 'win32'));
});

test('windows: matching is case-insensitive', () => {
  assert.ok(detector.isGameProcess(win('LEAGUE OF LEGENDS.EXE', 1), 'win32'));
});

test('macos: only the binary under /Game/ counts as the game client', () => {
  const gameProc = mac(
    '/Applications/League of Legends.app/Contents/LoL/Game/League of Legends.app/Contents/MacOS/League of Legends',
    300,
  );
  const launcher = mac('/Applications/League of Legends.app/Contents/MacOS/LeagueClientUx', 301);

  assert.ok(detector.isGameProcess(gameProc, 'darwin'));
  assert.ok(!detector.isGameProcess(launcher, 'darwin'));
  assert.ok(detector.isLauncherProcess(launcher, 'darwin'));
});

test('macos: a same-named binary outside /Game/ is not the game client', () => {
  const outer = mac('/Applications/League of Legends.app/Contents/MacOS/League of Legends', 302);
  assert.ok(!detector.isGameProcess(outer, 'darwin'));
});

test('linux: the game is matched through the wine command line', () => {
  const wine = {
    pid: 400,
    name: 'wine64-preloader',
    command: "/usr/bin/wine64 'C:/Riot Games/League of Legends/Game/League of Legends.exe' -t",
  };
  assert.ok(detector.isGameProcess(wine, 'linux'));
});

test('a launcher process is never reported as the game, even if it names the exe', () => {
  const launcherWithGameArgs = {
    pid: 500,
    name: 'RiotClientServices.exe',
    command: 'RiotClientServices.exe --launch-product=league_of_legends "League of Legends.exe"',
  };
  assert.ok(!detector.isGameProcess(launcherWithGameArgs, 'win32'));
  assert.ok(!detector.isGameProcess(launcherWithGameArgs, 'linux'));
});

test('extra process names from settings widen detection', () => {
  const custom = { pid: 600, name: 'lol-wrapper', command: '/opt/lol-wrapper --play' };
  assert.ok(!detector.isGameProcess(custom, 'win32'));
  assert.ok(detector.isGameProcess(custom, 'win32', ['lol-wrapper']));
});

test('findGameProcess picks the lowest pid so the choice is stable', () => {
  const records = [win('League of Legends.exe', 900), win('League of Legends.exe', 800)];
  assert.strictEqual(detector.findGameProcess(records, 'win32').pid, 800);
});
