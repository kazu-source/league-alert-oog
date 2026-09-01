'use strict';

const { EventEmitter } = require('node:events');
const { scanProcesses } = require('./processScanner');
const { findGameProcess, findLauncherProcess } = require('./gameDetector');
const { SessionTracker } = require('./sessionTracker');
const lcuClient = require('./lcu');

/**
 * Polling loop: scan the process list, feed it to the session tracker, and
 * emit game-start / game-end. Every dependency is injectable so tests can drive
 * it with a fake process list and a fake clock.
 *
 * Ticks never overlap — a slow scan delays the next one instead of stacking.
 */
class GameWatcher extends EventEmitter {
  constructor({
    settings,
    platform = process.platform,
    scan = scanProcesses,
    now = () => Date.now(),
    lcu = lcuClient,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    super();
    this.settings = settings;
    this.platform = platform;
    this.scan = scan;
    this.now = now;
    this.lcu = lcu;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.tracker = new SessionTracker({ missTolerance: settings.missTolerance });
    this.timer = null;
    this.ticking = false;
    // Bumped on every start/stop so results from an in-flight tick belonging to
    // a previous run are discarded instead of resurrecting a dropped session.
    this.generation = 0;
    this.enriching = false;
    this.credentials = null;

    this.status = {
      watching: false,
      inGame: false,
      launcherRunning: false,
      lastScanAt: null,
      lastError: null,
      lcuConnected: false,
      processCount: 0,
    };
  }

  getStatus() {
    return { ...this.status, session: this.tracker.getSession() };
  }

  /**
   * Apply new settings. Poll interval and miss tolerance take effect on the
   * next tick; a live session is preserved.
   */
  updateSettings(settings) {
    this.settings = settings;
    this.tracker.missTolerance = Math.max(0, settings.missTolerance);
  }

  start() {
    if (this.status.watching) return;
    this.generation += 1;
    this.status.watching = true;
    this.#emitStatus();
    this.#scheduleTick(0);
  }

  /** Stop polling and forget any in-progress game (no end event is emitted). */
  stop() {
    this.generation += 1;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.status.watching = false;
    this.status.inGame = false;
    this.tracker = new SessionTracker({ missTolerance: this.settings.missTolerance });
    this.#emitStatus();
  }

  #scheduleTick(delay) {
    if (!this.status.watching) return;
    const generation = this.generation;
    this.timer = this.setTimer(() => {
      this.tick().finally(() => {
        if (generation === this.generation) this.#scheduleTick(this.settings.pollIntervalMs);
      });
    }, delay);
  }

  /** One scan + state update. Safe to call directly in tests. */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    const generation = this.generation;
    try {
      const records = await this.scan({ platform: this.platform });
      // Watching was toggled off (or restarted) while this scan was running.
      if (generation !== this.generation) return;
      const now = this.now();
      const gameProcess = findGameProcess(records, this.platform, this.settings.extraGameProcessNames);
      const launcher = findLauncherProcess(records, this.platform);

      this.status.lastScanAt = now;
      this.status.lastError = null;
      this.status.processCount = records.length;
      this.status.launcherRunning = Boolean(launcher);

      const events = this.tracker.observe(gameProcess, now);
      this.status.inGame = this.tracker.isInGame;

      for (const event of events) {
        this.emit(event.type === 'start' ? 'game-start' : 'game-end', event.session);
      }

      if (this.status.inGame) this.#enrichInBackground();
      else this.status.lcuConnected = false;

      this.#emitStatus();
    } catch (error) {
      // A failed scan tells us nothing about the game, so the session state is
      // left untouched rather than being read as "the game closed".
      this.status.lastError = error.message || String(error);
      this.emit('scan-error', error);
      this.#emitStatus();
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Ask the launcher what is being played. Runs alongside the poll loop and is
   * skipped once the session is fully labelled.
   */
  #enrichInBackground() {
    if (!this.settings.useLcu || this.enriching) return;
    const session = this.tracker.getSession();
    if (!session || (session.queueName && session.isTFT !== null)) return;

    this.enriching = true;
    this.#enrich()
      .catch(() => {})
      .finally(() => {
        this.enriching = false;
      });
  }

  async #enrich() {
    if (!this.credentials) {
      this.credentials = await this.lcu.findCredentials({ platform: this.platform });
    }
    if (!this.credentials) {
      this.status.lcuConnected = false;
      return;
    }

    const gameflow = await this.lcu.getGameflow(this.credentials);
    if (!gameflow) {
      // Stale password (launcher restarted) — rediscover on the next attempt.
      this.credentials = null;
      this.status.lcuConnected = false;
      return;
    }

    this.status.lcuConnected = true;
    this.tracker.annotate({
      queueName: gameflow.queueName,
      gameMode: gameflow.gameMode,
      isTFT: gameflow.isTFT,
    });
    this.#emitStatus();
  }

  #emitStatus() {
    this.emit('status', this.getStatus());
  }
}

module.exports = { GameWatcher };
