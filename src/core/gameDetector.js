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
  win32: [
    { nameEquals: 'league of legends.exe', gameType: 'lol' },
    // TFT moved to its own Unreal Engine client, installed separately under
    // "Riot Games\Teamfight Tactics\<Live|PBE>". Its process is unrelated to
    // "League of Legends.exe", so before this it was invisible to detection --
    // TFT games produced no reminder at all.
    //
    // Two executables ship there: TFTClient.exe is Unreal's BootstrapPackagedGame
    // shim, which exits moments after launching the real client, so watching it
    // would end a "game" seconds after it began. The Shipping binary is the one
    // that lives for the whole match.
    { nameEquals: 'tftclient-win64-shipping.exe', gameType: 'tft' },
  ],
  // The launcher lives at .../League of Legends.app/Contents/MacOS/... while the
  // game lives under .../Contents/LoL/Game/..., so "/game/" is what separates them.
  darwin: [
    { nameEquals: 'league of legends', commandIncludes: ['/game/'], gameType: 'lol' },
    { nameIncludes: 'tftclient', gameType: 'tft' },
  ],
  // League only runs on Linux under Wine/Proton, where the Windows exe name
  // shows up inside the wine command line.
  linux: [
    { commandIncludes: ['league of legends.exe'], gameType: 'lol' },
    { commandIncludes: ['tftclient-win64-shipping.exe'], gameType: 'tft' },
  ],
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
const NEVER_GAME = [
  'leagueclient.exe',
  'leagueclientux',
  'riotclientservices',
  'riotclientux',
  // Unreal's bootstrap shim and helpers, which come and go independently of the
  // match: treating any of them as the game would end it early.
  'tftclient.exe',
  'epicwebhelper',
  'crashpad_handler',
];

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

/** @returns the first matcher that accepts `record`, or null. */
function firstMatch(record, matchers) {
  return matchers.find((matcher) => matches(record, matcher)) || null;
}

/**
 * Which game a process is, when the executable itself says so.
 * @returns {'lol'|'tft'|null} null when the process is not a game client, or
 * when it is one whose executable is shared between games (the pre-UE5 client,
 * and any user-supplied extra name) -- there the LCU has to label it.
 */
function gameTypeOf(record, platform = process.platform, extraNames = []) {
  if (!isGameProcess(record, platform, extraNames)) return null;
  const matcher = firstMatch(record, GAME_MATCHERS[platform] || []);
  return (matcher && matcher.gameType) || null;
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
  gameTypeOf,
  isGameProcess,
  isLauncherProcess,
  findGameProcess,
  findLauncherProcess,
};
