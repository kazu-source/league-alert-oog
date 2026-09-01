'use strict';

/**
 * Decides what to show when a game ends. Pure: it takes a finished session plus
 * settings and returns the notifications to fire, so the rules are testable
 * without spawning a window or waiting on a timer.
 */

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** "TFT game finished" / "League game finished" / "Game finished". */
function gameLabel(session) {
  if (session.isTFT === true) return 'TFT game finished';
  if (session.isTFT === false) return 'League game finished';
  return 'Game finished';
}

function summaryBody(session) {
  const parts = [];
  if (session.queueName) parts.push(session.queueName);
  parts.push(formatDuration(session.durationMs));
  return parts.join(' · ');
}

function notificationsAllowedFor(session, settings) {
  if (session.isTFT === true) return settings.notifyForTFT;
  if (session.isTFT === false) return settings.notifyForLoL;
  // Game type unknown (launcher closed / API unreachable): notify as long as the
  // user wants notifications for at least one of the two.
  return settings.notifyForLoL || settings.notifyForTFT;
}

function reminderAppliesToGame(reminder, session) {
  if (reminder.appliesTo === 'any') return true;
  // Type-specific reminders need a known type; without the launcher API we
  // cannot tell LoL from TFT, so they stay quiet rather than guess wrong.
  if (session.isTFT === null || session.isTFT === undefined) return false;
  return reminder.appliesTo === (session.isTFT ? 'tft' : 'lol');
}

/**
 * @param {object} args
 * @param {object} args.session finished session (from SessionTracker)
 * @param {object} args.settings merged settings
 * @param {number} args.gamesPlayed 1-based count of games finished so far,
 *   including this one — drives each reminder's "every N games" cadence
 * @returns {{skippedReason: string|null, notifications: Array}}
 */
function planNotifications({ session, settings, gamesPlayed = 1 }) {
  const durationSeconds = session.durationMs / 1000;

  if (durationSeconds < settings.minGameSeconds) {
    return { skippedReason: 'too-short', notifications: [] };
  }
  if (!notificationsAllowedFor(session, settings)) {
    return { skippedReason: 'game-type-muted', notifications: [] };
  }

  const title = gameLabel(session);
  const notifications = [];

  if (settings.showGameSummary) {
    notifications.push({
      id: `${session.id}:summary`,
      kind: 'summary',
      title,
      body: summaryBody(session),
      delayMs: 0,
    });
  }

  for (const reminder of settings.reminders) {
    if (!reminder.enabled) continue;
    if (!reminderAppliesToGame(reminder, session)) continue;
    if (reminder.everyNGames > 1 && gamesPlayed % reminder.everyNGames !== 0) continue;

    notifications.push({
      id: `${session.id}:${reminder.id}`,
      kind: 'reminder',
      reminderId: reminder.id,
      title,
      body: reminder.text,
      delayMs: reminder.delaySeconds * 1000,
    });
  }

  if (notifications.length === 0) {
    return { skippedReason: 'no-matching-reminders', notifications: [] };
  }
  return { skippedReason: null, notifications };
}

module.exports = { formatDuration, gameLabel, summaryBody, planNotifications };
