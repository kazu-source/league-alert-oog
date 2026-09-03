'use strict';

/**
 * Settings schema, defaults, and defensive merging.
 *
 * The config file is user-editable JSON, so every value coming off disk is
 * treated as untrusted and clamped back into range rather than trusted.
 */

const SETTINGS_VERSION = 1;

/** A reminder fires as one desktop notification after a game ends. */
function defaultReminders() {
  return [
    {
      id: 'stretch',
      text: 'Stand up and stretch for a minute.',
      enabled: true,
      delaySeconds: 0,
      appliesTo: 'any',
      everyNGames: 1,
    },
    {
      id: 'water',
      text: 'Drink some water.',
      enabled: true,
      delaySeconds: 0,
      appliesTo: 'any',
      everyNGames: 1,
    },
    {
      id: 'eyes',
      text: 'Look at something 20 feet away for 20 seconds.',
      enabled: false,
      delaySeconds: 30,
      appliesTo: 'any',
      everyNGames: 1,
    },
    {
      id: 'long-break',
      text: 'That is a few games in a row — take a real break before the next one.',
      enabled: false,
      delaySeconds: 0,
      appliesTo: 'any',
      everyNGames: 3,
    },
  ];
}

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,

  // Detection
  watchEnabled: true,
  pollIntervalMs: 4000,
  missTolerance: 1,
  minGameSeconds: 60,
  extraGameProcessNames: [],
  useLcu: true,

  // Notifications
  notifyForLoL: true,
  notifyForTFT: true,
  showGameSummary: true,
  playSound: true,
  cancelPendingOnNewGame: true,
  // Reminders are drawn by the app, not the OS, so the app owns how long they
  // stay on screen. 0 keeps a reminder up until it is clicked.
  popupDismissSeconds: 8,

  // App behaviour
  launchAtLogin: false,
  startMinimized: true,

  reminders: defaultReminders(),
};

const APPLIES_TO = new Set(['any', 'lol', 'tft']);

const LIMITS = {
  pollIntervalMs: { min: 1000, max: 60000 },
  missTolerance: { min: 0, max: 10 },
  minGameSeconds: { min: 0, max: 3600 },
  popupDismissSeconds: { min: 0, max: 120 },
  delaySeconds: { min: 0, max: 24 * 60 * 60 },
  everyNGames: { min: 1, max: 100 },
};

function clampInt(value, fallback, { min, max }) {
  // Guard the coercion explicitly: Number(null), Number(false) and Number([])
  // are all 0, which would silently clamp junk to the low end of the range
  // instead of falling back. Numeric strings are allowed — form inputs send them.
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

let idCounter = 0;

/** Ids only need to be unique within one config file. */
function newReminderId() {
  idCounter += 1;
  return `r-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function normalizeReminder(raw, seenIds) {
  const text = asString(raw && raw.text, '').trim();
  if (!text) return null;

  let id = asString(raw && raw.id, '').trim();
  if (!id || seenIds.has(id)) id = newReminderId();
  seenIds.add(id);

  const appliesTo = asString(raw && raw.appliesTo, 'any');

  return {
    id,
    text: text.slice(0, 500),
    enabled: asBool(raw && raw.enabled, true),
    delaySeconds: clampInt(raw && raw.delaySeconds, 0, LIMITS.delaySeconds),
    appliesTo: APPLIES_TO.has(appliesTo) ? appliesTo : 'any',
    everyNGames: clampInt(raw && raw.everyNGames, 1, LIMITS.everyNGames),
  };
}

function normalizeReminders(raw) {
  if (!Array.isArray(raw)) return defaultReminders();
  const seenIds = new Set();
  const out = [];
  for (const item of raw) {
    const reminder = normalizeReminder(item, seenIds);
    if (reminder) out.push(reminder);
  }
  return out;
}

function normalizeProcessNames(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name) out.push(name.slice(0, 200));
  }
  return out.slice(0, 20);
}

/**
 * Merge whatever was on disk over the defaults, dropping anything invalid.
 * Always returns a complete, usable settings object.
 */
function mergeSettings(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {};
  const d = DEFAULT_SETTINGS;

  return {
    version: SETTINGS_VERSION,

    watchEnabled: asBool(raw.watchEnabled, d.watchEnabled),
    pollIntervalMs: clampInt(raw.pollIntervalMs, d.pollIntervalMs, LIMITS.pollIntervalMs),
    missTolerance: clampInt(raw.missTolerance, d.missTolerance, LIMITS.missTolerance),
    minGameSeconds: clampInt(raw.minGameSeconds, d.minGameSeconds, LIMITS.minGameSeconds),
    extraGameProcessNames: normalizeProcessNames(raw.extraGameProcessNames),
    useLcu: asBool(raw.useLcu, d.useLcu),

    notifyForLoL: asBool(raw.notifyForLoL, d.notifyForLoL),
    notifyForTFT: asBool(raw.notifyForTFT, d.notifyForTFT),
    showGameSummary: asBool(raw.showGameSummary, d.showGameSummary),
    playSound: asBool(raw.playSound, d.playSound),
    popupDismissSeconds: clampInt(raw.popupDismissSeconds, d.popupDismissSeconds, LIMITS.popupDismissSeconds),
    cancelPendingOnNewGame: asBool(raw.cancelPendingOnNewGame, d.cancelPendingOnNewGame),

    launchAtLogin: asBool(raw.launchAtLogin, d.launchAtLogin),
    startMinimized: asBool(raw.startMinimized, d.startMinimized),

    reminders: normalizeReminders(raw.reminders),
  };
}

module.exports = {
  SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  LIMITS,
  defaultReminders,
  mergeSettings,
  newReminderId,
};
