'use strict';

/**
 * Pure state machine turning a stream of "is the game client running?"
 * observations into game-start / game-end events. No timers, no I/O — the
 * caller supplies the clock, which makes every transition unit-testable.
 */

let sequence = 0;

function nextSessionId(startedAt) {
  sequence += 1;
  return `g-${startedAt}-${sequence}`;
}

class SessionTracker {
  /**
   * @param {object} [options]
   * @param {number} [options.missTolerance] consecutive scans the process may be
   *   missing before the game counts as over. Guards against a scan that races
   *   with the process list; the recorded end time is still the moment it was
   *   last seen, so the tolerance never inflates game duration.
   */
  constructor({ missTolerance = 1 } = {}) {
    this.missTolerance = Math.max(0, missTolerance);
    this.session = null;
    this.misses = 0;
    this.lastSeenAt = null;
  }

  get isInGame() {
    return this.session !== null;
  }

  /** The live session, or null. */
  getSession() {
    return this.session ? { ...this.session } : null;
  }

  /**
   * Feed one scan result.
   * @param {{pid:number}|null} gameProcess the game client process, if running
   * @param {number} now epoch ms
   * @returns {Array<{type:'start'|'end', session:object}>} events, in order
   */
  observe(gameProcess, now) {
    if (gameProcess) return this.#observePresent(gameProcess, now);
    return this.#observeAbsent(now);
  }

  /**
   * Force the current session closed (app quitting, watching paused).
   * @returns {Array<{type:'end', session:object}>}
   */
  flush(now) {
    if (!this.session) return [];
    return [this.#end(this.lastSeenAt ?? now)];
  }

  #observePresent(gameProcess, now) {
    this.misses = 0;
    this.lastSeenAt = now;

    // A different pid means the previous game ended and a new one began between
    // two scans — close the old session before opening the new one.
    if (this.session && this.session.pid !== gameProcess.pid) {
      const ended = this.#end(now);
      return [ended, this.#begin(gameProcess, now)];
    }

    if (!this.session) return [this.#begin(gameProcess, now)];
    return [];
  }

  #observeAbsent(now) {
    if (!this.session) return [];
    this.misses += 1;
    if (this.misses <= this.missTolerance) return [];
    return [this.#end(this.lastSeenAt ?? now)];
  }

  #begin(gameProcess, startedAt) {
    this.session = {
      id: nextSessionId(startedAt),
      pid: gameProcess.pid,
      processName: gameProcess.name || null,
      startedAt,
      endedAt: null,
      durationMs: 0,
      // Filled in from the League Client API while the game is live.
      queueName: null,
      gameMode: null,
      isTFT: null,
    };
    return { type: 'start', session: { ...this.session } };
  }

  #end(endedAt) {
    const session = {
      ...this.session,
      endedAt,
      durationMs: Math.max(0, endedAt - this.session.startedAt),
    };
    this.session = null;
    this.misses = 0;
    this.lastSeenAt = null;
    return { type: 'end', session };
  }

  /** Merge League Client metadata into the live session. */
  annotate(details) {
    if (!this.session || !details) return;
    for (const key of ['queueName', 'gameMode', 'isTFT']) {
      if (details[key] !== undefined && details[key] !== null) {
        this.session[key] = details[key];
      }
    }
  }
}

module.exports = { SessionTracker };
