'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { mergeSettings } = require('../core/settings');

const MAX_HISTORY = 25;

/**
 * JSON-file persistence for settings, the finished-game log, and the counter
 * that drives "every N games" reminders.
 *
 * Writes go to a temp file and are renamed into place, so a crash mid-write
 * cannot leave a half-written config behind. Writes are also chained, so two
 * quick saves cannot interleave.
 */
class Store {
  constructor({ dir, fileName = 'config.json' }) {
    this.file = path.join(dir, fileName);
    this.dir = dir;
    this.data = { settings: mergeSettings(null), stats: { gamesPlayed: 0 }, history: [] };
    this.writeQueue = Promise.resolve();
  }

  /** Read the config, falling back to defaults for a missing or corrupt file. */
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.data = {
        settings: mergeSettings(raw.settings),
        stats: { gamesPlayed: Number.isInteger(raw.stats?.gamesPlayed) ? raw.stats.gamesPlayed : 0 },
        history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY) : [],
      };
    } catch {
      this.data = { settings: mergeSettings(null), stats: { gamesPlayed: 0 }, history: [] };
    }
    return this.data;
  }

  getSettings() {
    return this.data.settings;
  }

  getStats() {
    return { ...this.data.stats };
  }

  getHistory() {
    return this.data.history.slice();
  }

  /** Merge a partial update over the current settings and persist. */
  async saveSettings(patch) {
    this.data.settings = mergeSettings({ ...this.data.settings, ...patch });
    await this.#persist();
    return this.data.settings;
  }

  /**
   * Log a finished game.
   * @returns {number} the running game count, used for "every N games" cadence
   */
  async recordGame(session, { skippedReason = null } = {}) {
    this.data.stats.gamesPlayed += 1;
    this.data.history.unshift({
      id: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      queueName: session.queueName,
      isTFT: session.isTFT,
      skippedReason,
    });
    this.data.history = this.data.history.slice(0, MAX_HISTORY);
    await this.#persist();
    return this.data.stats.gamesPlayed;
  }

  async clearHistory() {
    this.data.history = [];
    await this.#persist();
  }

  #persist() {
    this.writeQueue = this.writeQueue.then(() => this.#writeFile()).catch(() => {});
    return this.writeQueue;
  }

  async #writeFile() {
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(temp, this.file);
  }
}

module.exports = { Store, MAX_HISTORY };
