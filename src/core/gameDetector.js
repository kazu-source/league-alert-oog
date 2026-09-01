'use strict';

/**
 * Tells the *game* client apart from the *launcher* client.
 *
 * Riot ships two very different executables:
 *
 *   Launcher / base client   LeagueClient(.exe), LeagueClientUx(.exe),
 *                            RiotClientServices(.exe) — the window you log in
 *                            to, pick champions in, and leave open all evening.
 *                            Closing this must NOT count as finishing a game.
 *
 *   Game client              "League of Legends.exe" (Windows) or the binary
 *                            inside .../LoL/Game/League of Legends.app (macOS).
 *                            It is spawned when the match loads and exits when
 *                            you leave the post-game screen. That exit is the
 *                            event this whole app is built around.
 *
 * Teamfight Tactics on desktop runs inside the *same* game client executable,
 * so the process alone cannot say whether a match was LoL or TFT. That
 * distinction comes from the League Client API while the game is live (lcu.js).
 */

/**
 * A matcher passes when every field it declares matches (case-insensitive).
 *  - nameEquals:      exact process/executable basename
 *  - commandIncludes: every listed substring must appear in the command/path
 */
const GAME_MATCHERS = {
  win32: [{ nameEquals: 'league of legends.exe' }],
  // The launcher lives at .../League of Legends.app/Contents/MacOS/... while the
  // game lives under .../Contents/LoL/Game/..., so "/game/" is what separates them.
  darwin: [{ nameEquals: 'league of legends', commandIncludes: ['/game/'] }],
  // League only runs on Linux under Wine/Proton, where the Windows exe name
  // shows up inside the wine command line.
  linux: [{ commandIncludes: ['league of legends.exe'] }],
};

const CLIENT_MATCHERS = {
  win32: [
    { nameEquals: 'leagueclientux.exe' },
    { nameEquals: 'leagueclient.exe' },
    { nameEquals: 'riotclientservices.exe' },
  ],
  darwin: [
    { nameEquals: 'leagueclientux' },
    { nameEquals: 'leagueclient' },
    { nameEquals: 'riotclientservices' },
  ],
  linux: [
    { commandIncludes: ['leagueclientux.exe'] },
    { commandIncludes: ['leagueclient.exe'] },
    { commandIncludes: ['riotclientservices.exe'] },
  ],
};

/**
 * Never treat these as the game client, whatever else matched. Guards against a
 * launcher process whose command line happens to mention the game executable.
 */
const NEVER_GAME = ['leagueclient.exe', 'leagueclientux', 'riotclientservices', 'riotclientux'];

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function matches(record, matcher) {
  const name = lower(record.name);
  const command = lower(record.command || record.name);

  if (matcher.nameEquals && name !== lower(matcher.nameEquals)) return false;
  if (matcher.nameIncludes && !name.includes(lower(matcher.nameIncludes))) return false;
  if (matcher.commandIncludes) {
    for (const needle of matcher.commandIncludes) {
      if (!command.includes(lower(needle))) return false;
    }
  }
  return true;
}

function matchesAny(record, matchers) {
  return matchers.some((matcher) => matches(record, matcher));
}

/** User-supplied names from settings, matched against name or command. */
function extraMatchers(extraNames) {
  if (!Array.isArray(extraNames)) return [];
  return extraNames
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => ({ commandIncludes: [name.trim()] }));
}

function isLauncherProcess(record, platform = process.platform) {
  return matchesAny(record, CLIENT_MATCHERS[platform] || []);
}

function isGameProcess(record, platform = process.platform, extraNames = []) {
  const command = lower(record.command || record.name);
  const name = lower(record.name);
  if (NEVER_GAME.some((needle) => name.includes(needle) || command.includes(needle))) return false;

  const matchers = [...(GAME_MATCHERS[platform] || []), ...extraMatchers(extraNames)];
  return matchesAny(record, matchers);
}

/**
 * @returns the running game-client process, or null.
 * When several match (shouldn't happen), the lowest pid wins so the choice is
 * stable across scans.
 */
function findGameProcess(records, platform = process.platform, extraNames = []) {
  const hits = (records || []).filter((record) => isGameProcess(record, platform, extraNames));
  if (hits.length === 0) return null;
  return hits.reduce((lowest, record) => (record.pid < lowest.pid ? record : lowest));
}

/** @returns the running launcher/base-client process, or null. */
function findLauncherProcess(records, platform = process.platform) {
  const hits = (records || []).filter((record) => isLauncherProcess(record, platform));
  if (hits.length === 0) return null;
  return hits.reduce((lowest, record) => (record.pid < lowest.pid ? record : lowest));
}

module.exports = {
  GAME_MATCHERS,
  CLIENT_MATCHERS,
  isGameProcess,
  isLauncherProcess,
  findGameProcess,
  findLauncherProcess,
};
