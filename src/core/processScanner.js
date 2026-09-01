'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

/**
 * Cross-platform process listing.
 *
 * This runs on a timer (every few seconds), so the hot path uses the cheapest
 * command that still answers "is the game client running?":
 *
 *   Windows  tasklist  — image names only, no command lines, very fast.
 *   macOS    ps -o comm — full executable path, which is what lets us tell the
 *                         game client apart from the launcher client.
 *   Linux    ps -o args — full command line (League only runs here through
 *                         Wine/Proton, where the .exe name lives in the args).
 *
 * Command lines (needed to discover LCU credentials) are fetched separately and
 * only when a game actually starts — see lcu.js.
 */

const SCAN_COMMANDS = {
  win32: { cmd: 'tasklist', args: ['/fo', 'csv', '/nh'] },
  darwin: { cmd: 'ps', args: ['-A', '-o', 'pid=,comm='] },
  linux: { cmd: 'ps', args: ['-A', '-o', 'pid=,args='] },
};

const EXEC_OPTIONS = {
  timeout: 10000,
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
};

/** Split one CSV record, honouring "" escaping inside quoted fields. */
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/** `tasklist /fo csv /nh` → [{ pid, name, command }] */
function parseTasklist(stdout) {
  const records = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 2) continue;
    const name = fields[0].trim();
    const pid = Number.parseInt(fields[1], 10);
    if (!name || !Number.isInteger(pid)) continue;
    records.push({ pid, name, command: name });
  }
  return records;
}

/**
 * `ps -A -o pid=,comm=` / `pid=,args=` → [{ pid, name, command }]
 *
 * Executable paths contain spaces ("League of Legends"), so everything after
 * the pid is one value; `name` is its basename (first token for arg lists).
 */
function parsePsOutput(stdout) {
  const records = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(rawLine);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const command = match[2];
    if (!Number.isInteger(pid) || !command) continue;
    records.push({ pid, name: path.basename(command.split(' ')[0]) || command, command });
  }
  return records;
}

function parseScanOutput(platform, stdout) {
  return platform === 'win32' ? parseTasklist(stdout) : parsePsOutput(stdout);
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, EXEC_OPTIONS, (error, stdout) => {
      // tasklist and ps both exit non-zero on some transient conditions while
      // still printing a usable list, so stdout wins when we have it.
      if (error && !stdout) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * List running processes.
 * @returns {Promise<Array<{pid:number,name:string,command:string}>>}
 */
async function scanProcesses({ platform = process.platform, run = runCommand } = {}) {
  const spec = SCAN_COMMANDS[platform];
  if (!spec) throw new Error(`Process scanning is not supported on "${platform}".`);
  const stdout = await run(spec.cmd, spec.args);
  return parseScanOutput(platform, stdout);
}

module.exports = {
  SCAN_COMMANDS,
  parseCsvLine,
  parseTasklist,
  parsePsOutput,
  parseScanOutput,
  scanProcesses,
};
