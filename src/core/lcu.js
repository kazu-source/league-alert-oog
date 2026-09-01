'use strict';

const https = require('node:https');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');

/**
 * Optional enrichment through the League Client API (LCU).
 *
 * The game client executable is shared by League and Teamfight Tactics, so the
 * only way to label a finished match is to ask the launcher what is being
 * played *while it is being played*. Everything here is best-effort: if the
 * launcher is closed, the endpoints move, or auth fails, detection still works
 * and the reminder simply says "game" instead of "Ranked TFT".
 *
 * The API listens on 127.0.0.1 behind HTTP Basic auth with a per-launch
 * password, served over a self-signed certificate. Certificate verification is
 * therefore disabled — but only for requests pinned to 127.0.0.1, and the
 * password never leaves the machine.
 */

const LOCKFILE_PATHS = {
  win32: [
    'C:\\Riot Games\\League of Legends\\lockfile',
    'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  ],
  darwin: ['/Applications/League of Legends.app/Contents/LoL/lockfile'],
  linux: [],
};

const COMMAND_LINE_QUERY = {
  win32: {
    cmd: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
    ],
  },
  darwin: { cmd: 'ps', args: ['-A', '-o', 'args='] },
  linux: { cmd: 'ps', args: ['-A', '-o', 'args='] },
};

/** Queue ids known to be Teamfight Tactics, used only if gameMode is missing. */
const TFT_QUEUE_IDS = new Set([1090, 1100, 1110, 1130, 1150, 1160, 1170, 1180]);

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) reject(error);
      else resolve(stdout || '');
    });
  });
}

/** `LeagueClient:PID:PORT:PASSWORD:PROTOCOL` */
function parseLockfile(text) {
  const parts = String(text).trim().split(':');
  if (parts.length < 5) return null;
  const port = Number.parseInt(parts[2], 10);
  const password = parts[3];
  if (!Number.isInteger(port) || port <= 0 || !password) return null;
  return { port, password, source: 'lockfile' };
}

/** Pull `--app-port` / `--remoting-auth-token` out of a LeagueClientUx command line. */
function parseCommandLineCredentials(text) {
  const haystack = String(text);
  for (const line of haystack.split(/\r?\n/)) {
    if (!/leagueclientux/i.test(line)) continue;
    const port = /--app-port=("?)(\d+)\1/.exec(line);
    const token = /--remoting-auth-token=("?)([\w-]+)\1/.exec(line);
    if (port && token) {
      return { port: Number.parseInt(port[2], 10), password: token[2], source: 'command-line' };
    }
  }
  return null;
}

/**
 * Locate LCU credentials, preferring the live command line (survives custom
 * install directories) and falling back to the lockfile.
 * @returns {Promise<{port:number,password:string,source:string}|null>}
 */
async function findCredentials({
  platform = process.platform,
  run = runCommand,
  readFile = (file) => fs.readFile(file, 'utf8'),
  lockfilePaths = LOCKFILE_PATHS[platform] || [],
} = {}) {
  const query = COMMAND_LINE_QUERY[platform];
  if (query) {
    try {
      const found = parseCommandLineCredentials(await run(query.cmd, query.args));
      if (found) return found;
    } catch {
      // Launcher not running, or the query is unavailable — try the lockfile.
    }
  }

  for (const file of lockfilePaths) {
    try {
      const found = parseLockfile(await readFile(file));
      if (found) return found;
    } catch {
      // Missing lockfile just means the launcher is closed.
    }
  }
  return null;
}

/**
 * GET a JSON endpoint from the local League Client API.
 * @returns {Promise<any>} parsed body; rejects on transport or non-2xx errors
 */
function lcuRequest(credentials, endpoint, { timeout = 4000, request = https.request } = {}) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`riot:${credentials.password}`).toString('base64');
    const req = request(
      {
        host: '127.0.0.1',
        port: credentials.port,
        path: endpoint,
        method: 'GET',
        // Localhost-only, self-signed certificate issued per launcher install.
        rejectUnauthorized: false,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        timeout,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2 * 1024 * 1024) req.destroy(new Error('LCU response too large'));
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`LCU ${endpoint} returned HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`LCU ${endpoint} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

/** Reduce a /lol-gameflow/v1/session payload to the few fields we display. */
function normalizeGameflow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const gameData = raw.gameData || {};
  const queue = gameData.queue || {};
  const map = raw.map || {};

  const gameMode = queue.gameMode || map.gameMode || null;
  const queueId = Number.isInteger(queue.id) ? queue.id : null;
  const isTFT = gameMode ? String(gameMode).toUpperCase().includes('TFT') : queueId !== null ? TFT_QUEUE_IDS.has(queueId) : null;

  const queueName = typeof queue.name === 'string' && queue.name.trim() ? queue.name.trim() : null;

  return {
    phase: typeof raw.phase === 'string' ? raw.phase : null,
    queueId,
    queueName,
    gameMode,
    isTFT,
  };
}

/** @returns {Promise<object|null>} normalized gameflow state, or null if unavailable */
async function getGameflow(credentials, options = {}) {
  if (!credentials) return null;
  try {
    return normalizeGameflow(await lcuRequest(credentials, '/lol-gameflow/v1/session', options));
  } catch {
    return null;
  }
}

module.exports = {
  LOCKFILE_PATHS,
  TFT_QUEUE_IDS,
  parseLockfile,
  parseCommandLineCredentials,
  findCredentials,
  lcuRequest,
  normalizeGameflow,
  getGameflow,
};
